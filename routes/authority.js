import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Authority from "../models/Authority.js";
import Complaint from "../models/Complaint.js";
import { protectAuthority } from "../middleware/authMiddleware.js";
import {
  municipalCorporations,
  municipalCouncils,
  villageKeywords,
  urbanKeywords,
} from "../data/authorityData.js";
import fetch from "node-fetch";

const router = express.Router();

/**
 * Reverse geocode using multi-provider strategy (Nominatim -> BigDataCloud)
 */
async function reverseGeocode(lat, lng) {
  // 1. Try Nominatim with timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&accept-language=en`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CivicReporter/1.0 (contact: support@civicreporter.in)" },
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      if (data && data.address) {
        return extractNominatimAddress(data);
      }
    }
  } catch (err) {
    console.warn("Nominatim reverse geocode attempt failed, trying fallback:", err.message);
  }

  // 2. High-speed, unthrottled fallback: BigDataCloud Reverse Geocoding
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const bdcRes = await fetch(bdcUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });
    clearTimeout(timeout);
    if (bdcRes.ok) {
      const bdcData = await bdcRes.json();
      if (bdcData) {
        return extractBigDataCloudAddress(bdcData);
      }
    }
  } catch (err) {
    console.error("BigDataCloud fallback failed:", err.message);
  }

  return null;
}

/**
 * Extract structured address components from Nominatim response
 */
function extractNominatimAddress(nominatimData) {
  if (!nominatimData || !nominatimData.address) return null;

  const addr = nominatimData.address;

  let district = (addr.county || addr.district || "").replace(/\s*district$/i, "").trim();
  if (!district || /division/i.test(district)) {
    district = (addr.state_district && !/division/i.test(addr.state_district))
      ? addr.state_district.replace(/\s*district$/i, "").trim()
      : "Kolhapur";
  }

  let taluka = (addr.county || addr.subdistrict || "").replace(/\s*taluka$/i, "").trim();
  if (/division/i.test(taluka)) taluka = "";

  return {
    village: addr.village || addr.hamlet || addr.isolated_dwelling || "",
    town: addr.town || addr.borough || "",
    city: addr.city || addr.municipality || addr.city_district || "",
    suburb: addr.suburb || addr.neighbourhood || addr.residential || "",
    district: district,
    taluka: taluka,
    state: addr.state || "",
    postcode: addr.postcode || "",
    country: addr.country || "India",
    placeType: nominatimData.type || "",
    placeClass: nominatimData.class || "",
    displayName: nominatimData.display_name || "",
  };
}

/**
 * Extract structured address from BigDataCloud response
 */
function extractBigDataCloudAddress(bdc) {
  const adminList = bdc.localityInfo?.administrative || [];
  
  let district = "";
  let taluka = "";
  let cityOrTown = bdc.city || bdc.locality || "";
  
  for (const item of adminList) {
    if (item.adminLevel === 5) {
      district = item.name.replace(/\s*district$/i, "").trim();
    }
    if (item.adminLevel === 6) {
      if (item.name.toLowerCase().includes("taluka")) {
        taluka = item.name.replace(/\s*taluka$/i, "").trim();
      } else if (!cityOrTown) {
        cityOrTown = item.name;
      }
    }
  }

  const cleanDist = (district && !/division/i.test(district)) ? district : "Kolhapur";
  const state = bdc.principalSubdivision || "";
  const displayName = [cityOrTown, taluka, cleanDist, state].filter(Boolean).join(", ");

  return {
    village: bdc.locality || "",
    town: bdc.locality || "",
    city: cityOrTown || "",
    suburb: "",
    district: cleanDist,
    taluka: taluka || cleanDist || "",
    state: state,
    postcode: bdc.postcode || "",
    country: bdc.countryName || "India",
    placeType: "locality",
    placeClass: "",
    displayName: displayName,
  };
}

/**
 * Normalize a string for comparison (lowercase, trim, remove diacritics)
 */
function normalize(str) {
  return (str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Match a place name against the corporation/council datasets
 */
function matchInDataset(placeName, dataset) {
  const normalized = normalize(cleanPlaceName(placeName));
  if (!normalized || normalized.length < 3) return null;

  for (const entry of dataset) {
    const entryName = normalize(entry.name);
    const allNames = [entryName, ...entry.aliases.map(normalize)];

    for (const name of allNames) {
      if (!name) continue;
      if (normalized === name) return entry;
      const regex = new RegExp(`\\b${name}\\b`, "i");
      if (regex.test(normalized)) return entry;
    }
  }
  return null;
}

/**
 * Check if the address contains village-like keywords
 */
function hasVillageKeywords(addressString) {
  const lower = normalize(addressString);
  return villageKeywords.some((kw) => lower.includes(kw));
}

/**
 * Check if the address contains urban keywords
 */
function hasUrbanKeywords(addressString) {
  const lower = normalize(addressString);
  return urbanKeywords.some((kw) => lower.includes(kw));
}

/**
 * Clean string to remove any Division contamination (e.g. Pune Division) and duplicate authority words
 */
export function cleanAddressString(addrStr) {
  if (!addrStr || typeof addrStr !== "string") return "";
  return addrStr
    .replace(/,?\s*(?:in\s+)?pune\s+division\b/gi, "")
    .replace(/,?\s*\bin\s+pune\b/gi, "")
    .replace(/,?\s*(?:in\s+)?[A-Za-z]+\s+division\b/gi, "")
    .replace(/\bdivision\b/gi, "")
    .replace(/\b(?:mun[a-z]+)\s+corporation\b/gi, "")
    .replace(/\b(?:mun[a-z]+)\s+council\b/gi, "")
    .replace(/\b(?:gram\s+panchayat|nagar\s+palika|nagar\s+parishad|mahanagar\s+palika)\b/gi, "")
    .replace(/\s*\bin\b(?=\s*,|\s*$|\s+kolhapur|\s+maharashtra)/gi, "")
    .replace(/\bin\s*$/gi, "")
    .replace(/,?\s*[A-Z0-9]{2,}-[A-Z0-9]+/g, "")
    .replace(/\s*,\s*,/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * Clean and filter place names (removes asset IDs, pole IDs, plus codes, survey numbers, divisions, authority words, and thoroughfares)
 */
export function cleanPlaceName(name) {
  if (!name || typeof name !== "string") return "";
  let trimmed = name.trim();
  trimmed = trimmed
    .replace(/,?\s*(?:in\s+)?pune\s+division\b/gi, "")
    .replace(/,?\s*\bin\s+pune\b/gi, "")
    .replace(/,?\s*(?:in\s+)?[A-Za-z]+\s+division\b/gi, "")
    .replace(/\bdivision\b/gi, "")
    .replace(/\b(?:mun[a-z]+)\s+corporation\b/gi, "")
    .replace(/\b(?:mun[a-z]+)\s+council\b/gi, "")
    .replace(/\b(?:gram\s+panchayat|nagar\s+palika|nagar\s+parishad|mahanagar\s+palika)\b/gi, "")
    .replace(/\s*\bin\b(?=\s*,|\s*$|\s+kolhapur|\s+maharashtra)/gi, "")
    .replace(/\bin\s*$/gi, "")
    .replace(/,?\s*[A-Z0-9]{2,}-[A-Z0-9]+/g, "")
    .replace(/\s*,\s*,/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();

  // Filter out machine codes, plus codes, survey numbers, asset IDs like HPSBA-C393743
  if (/^[A-Z0-9]{2,}-[A-Z0-9]+$/i.test(trimmed)) return "";
  if (/[0-9]{3,}/.test(trimmed)) return ""; // Has 3+ digits
  if (/^[0-9]+/.test(trimmed)) return ""; // Starts with numbers like street/door/plot
  if (/\+/.test(trimmed)) return ""; // Plus codes like 8F7X+9Q

  // Strip thoroughfare suffixes rather than discarding the whole place name
  // e.g. "Padli Khurd Road" -> "Padli Khurd", "Shingnapur Highway" -> "Shingnapur"
  trimmed = trimmed
    .replace(/\b(?:road|street|marg|rasta|lane|gali|path|highway|nh\s*\d+|sh\s*\d+|bypass|chowk|circle|bridge|flyover)\b/gi, "")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();

  // Discard pure prepositions or adjectives that have no village noun
  if (/^(?:main|near|opp|opposite|behind|front|beside|across|old|new)$/i.test(trimmed)) return "";

  return trimmed;
}

/**
 * Main authority detection logic with coordinate geofencing
 */
export function detectAuthority(structuredAddress, lat = null, lng = null) {
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  const hasCoords = !isNaN(numLat) && !isNaN(numLng) && numLat !== 0 && numLng !== 0;

  // Exact urban core boundary for Kolhapur Municipal Corporation (KMC)
  // Everything outside this box (e.g. Shingnapur, Padli Khurd, Balinge, Chikhali) is rural Gram Panchayat
  const isKolhapurUrbanCore = hasCoords && (numLat >= 16.680 && numLat <= 16.715 && numLng >= 74.220 && numLng <= 74.255);
  const isKolhapurRural = hasCoords && (numLng < 74.220 || numLng > 74.255 || numLat < 16.680 || numLat > 16.715);

  if (!structuredAddress) {
    if (isKolhapurRural) {
      return {
        authorityType: "gram_panchayat",
        authorityTitle: "The Sarpanch",
        authorityBody: "Gram Panchayat Local Village",
        confidence: 85,
        detectionMethod: "rural_coordinate_geofence_no_addr",
      };
    }
    return {
      authorityType: "municipal_corporation",
      authorityTitle: "The Municipal Commissioner",
      authorityBody: "Municipal Corporation Kolhapur",
      confidence: 50,
      detectionMethod: "fallback",
    };
  }

  const village = cleanPlaceName(structuredAddress.village);
  const town = cleanPlaceName(structuredAddress.town);
  const city = cleanPlaceName(structuredAddress.city);
  const suburb = cleanPlaceName(structuredAddress.suburb);
  const district = cleanPlaceName(structuredAddress.district);

  // List of known Gram Panchayats in Kolhapur district and surrounding rural areas
  const knownGramPanchayats = [
    "shinganapur", "singanapur", "shingnapur", "padli khurd", "padli budruk", "padli",
    "balinge", "shiroli", "uchgaon", "uchgoan", "vadanage", "vadange", "nigave",
    "chikhali", "kerli", "kerle", "prayag chikhali", "gandhinagar", "kalamba",
    "pachgaon", "pachgoan", "morewadi", "gokul shirgaon", "tamgaon",
    "halondi", "mudshingi", "vasagade", "sarnobatwadi", "girgaon",
    "kandgaon", "ambewadi", "kagal", "hatkanangle", "rukadi", "kuditre", "khupire",
    "koparde", "kale", "kotoli", "beed", "panhala", "porle", "sawarde",
    "vashi", "nandgaon", "chafodi", "bahirewadi", "rashivade", "ispurlie",
    "hasur", "kanoor", "sadoli", "parite", "radhanagari", "bhudargad", "ajra",
    "chandgad", "gadhinglaj", "gargoti", "murgud", "hupari"
  ];

  // List of known urban wards inside Kolhapur Municipal Corporation (KMC)
  const knownKolhapurUrbanWards = [
    "shahupuri", "rajarampuri", "laxmipuri", "tarabai park", "kasba bawada",
    "phulewadi", "rankala", "mangalwar peth", "somwar peth", "shivaji peth",
    "shukrawar peth", "raviwar peth", "budhwar peth", "guruwar peth", "sambhajinagar",
    "ruikar colony", "nagala park", "kadamwadi", "sasane nagar", "line bazar",
    "pratibha nagar", "dabholkar corner", "station road", "cbs", "mahadwar road",
    "bindu chowk", "dasara chowk", "bhavani mandap"
  ];

  const candidatePlaces = [village, suburb, town, city].filter(Boolean);

  // Strategy 1: Check known urban wards inside Kolhapur city first
  for (const place of candidatePlaces) {
    const norm = normalize(place);
    if (knownKolhapurUrbanWards.some((w) => norm === w || norm.includes(w) || w.includes(norm))) {
      return {
        authorityType: "municipal_corporation",
        authorityTitle: "The Municipal Commissioner",
        authorityBody: "Municipal Corporation Kolhapur",
        confidence: 99,
        detectionMethod: "kmc_urban_ward",
      };
    }
  }

  // Strategy 2: Direct match with known Gram Panchayats
  for (const place of candidatePlaces) {
    const norm = normalize(place);
    if (knownGramPanchayats.some((gp) => norm === gp || norm.includes(gp) || gp.includes(norm))) {
      return {
        authorityType: "gram_panchayat",
        authorityTitle: "The Sarpanch",
        authorityBody: `Gram Panchayat ${place}`,
        confidence: 99,
        detectionMethod: "known_gram_panchayat_list",
      };
    }
  }

  // Strategy 3: If village or suburb has village keywords (like "khurd", "budruk", "pur", "wadi", "gaon", etc.)
  for (const place of [village, suburb, town]) {
    if (place && hasVillageKeywords(place)) {
      const corpMatch = matchInDataset(place, municipalCorporations);
      const councilMatch = matchInDataset(place, municipalCouncils);
      if (!corpMatch && !councilMatch) {
        return {
          authorityType: "gram_panchayat",
          authorityTitle: "The Sarpanch",
          authorityBody: `Gram Panchayat ${place}`,
          confidence: 95,
          detectionMethod: "village_keyword_match",
        };
      }
    }
  }

  // Strategy 4: If village field is explicitly specified, it is ALWAYS Gram Panchayat
  if (village) {
    return {
      authorityType: "gram_panchayat",
      authorityTitle: "The Sarpanch",
      authorityBody: `Gram Panchayat ${village}`,
      confidence: 92,
      detectionMethod: "village_field_priority",
    };
  }

  // If coordinates are in rural Kolhapur, it is ALWAYS a Gram Panchayat (or Municipal Council for known towns)
  if (isKolhapurRural) {
    if (town) {
      const councilMatch = matchInDataset(town, municipalCouncils);
      if (councilMatch) {
        return {
          authorityType: "municipal_council",
          authorityTitle: "The Chief Officer",
          authorityBody: `Municipal Council ${councilMatch.name}`,
          confidence: 95,
          detectionMethod: "dataset_council_town",
          matchedEntry: councilMatch,
        };
      }
    }
    const cleanP = cleanPlaceName(village || suburb || town);
    const finalPlace = (cleanP && cleanP.toLowerCase() !== "kolhapur" && cleanP.toLowerCase() !== "pune") ? cleanP : "Local Village";
    return {
      authorityType: "gram_panchayat",
      authorityTitle: "The Sarpanch",
      authorityBody: `Gram Panchayat ${finalPlace}`,
      confidence: 90,
      detectionMethod: "rural_coordinate_strict_gram_panchayat",
    };
  }

  // Strategy 5: Check if town matches a Municipal Council
  if (town) {
    const councilMatch = matchInDataset(town, municipalCouncils);
    if (councilMatch) {
      return {
        authorityType: "municipal_council",
        authorityTitle: "The Chief Officer",
        authorityBody: `Municipal Council ${councilMatch.name}`,
        confidence: 95,
        detectionMethod: "dataset_council_town",
        matchedEntry: councilMatch,
      };
    }
  }

  // Strategy 6: Check if city matches a Municipal Corporation (only for core cities)
  if (city) {
    const corpMatch = matchInDataset(city, municipalCorporations);
    if (corpMatch && corpMatch.name.toLowerCase() !== "pune") {
      return {
        authorityType: "municipal_corporation",
        authorityTitle: "The Municipal Commissioner",
        authorityBody: `Municipal Corporation ${corpMatch.name}`,
        confidence: 95,
        detectionMethod: "dataset_corporation_city",
        matchedEntry: corpMatch,
      };
    }

    const councilMatch = matchInDataset(city, municipalCouncils);
    if (councilMatch) {
      return {
        authorityType: "municipal_council",
        authorityTitle: "The Chief Officer",
        authorityBody: `Municipal Council ${councilMatch.name}`,
        confidence: 90,
        detectionMethod: "dataset_council_city",
        matchedEntry: councilMatch,
      };
    }
  }

  // Strategy 7: Check suburb against corporations
  if (suburb) {
    const corpMatch = matchInDataset(suburb, municipalCorporations);
    if (corpMatch && corpMatch.name.toLowerCase() !== "pune") {
      return {
        authorityType: "municipal_corporation",
        authorityTitle: "The Municipal Commissioner",
        authorityBody: `Municipal Corporation ${corpMatch.name}`,
        confidence: 90,
        detectionMethod: "dataset_corporation_suburb",
        matchedEntry: corpMatch,
      };
    }
  }

  // Default fallback: Gram Panchayat for rural places, else Kolhapur Municipal Corporation
  const placeName = suburb || village || town;
  if (placeName && placeName.toLowerCase() !== "kolhapur") {
    return {
      authorityType: "gram_panchayat",
      authorityTitle: "The Sarpanch",
      authorityBody: `Gram Panchayat ${placeName}`,
      confidence: 80,
      detectionMethod: "fallback_rural",
    };
  }

  return {
    authorityType: "municipal_corporation",
    authorityTitle: "The Municipal Commissioner",
    authorityBody: "Municipal Corporation Kolhapur",
    confidence: 70,
    detectionMethod: "fallback_kmc",
  };
}

/**
 * Generate the formal letter header based on authority
 */
export function generateLetterHeader(authorityResult, structuredAddress) {
  const { authorityTitle, authorityBody } = authorityResult;
  const addr = structuredAddress || {};
  let dist = cleanPlaceName(addr.district);
  if (!dist || /division/i.test(dist)) dist = "Kolhapur";
  const st = cleanPlaceName(addr.state) || "Maharashtra";

  if (authorityResult.authorityType === "gram_panchayat") {
    const talukaLine = addr.taluka && !/division/i.test(addr.taluka) ? `Taluka ${cleanPlaceName(addr.taluka)},\n` : "";
    return `To,\n${authorityTitle},\n${authorityBody},\n${talukaLine}District ${dist}, ${st}`;
  }

  return `To,\n${authorityTitle},\n${authorityBody},\nDistrict ${dist}, ${st}`;
}

// ===================================================
// API ENDPOINT: GET & POST /api/authority/detect
// ===================================================
router.get("/detect", async (req, res, next) => {
  req.body = {
    latitude: req.query.lat || req.query.latitude,
    longitude: req.query.lng || req.query.longitude,
    address: req.query.address ? (typeof req.query.address === 'string' ? JSON.parse(req.query.address) : req.query.address) : null
  };
  return handleDetect(req, res);
});

router.post("/detect", async (req, res) => {
  return handleDetect(req, res);
});

async function handleDetect(req, res) {
  try {
    const lat = req.body.lat !== undefined ? req.body.lat : req.body.latitude;
    const lng = req.body.lng !== undefined ? req.body.lng : req.body.longitude;
    const address = req.body.address;

    let structuredAddress = null;

    // If structured address components provided directly from mobile client
    if (address && typeof address === "object") {
      const v = cleanPlaceName(address.village || address.subLocality || address.name);
      const sub = cleanPlaceName(address.suburb || address.subLocality || address.name);
      const c = cleanPlaceName(address.city);
      const t = cleanPlaceName(address.town);
      let dist = cleanPlaceName(address.district);
      if (!dist || /division/i.test(dist)) dist = "Kolhapur";
      const tal = cleanPlaceName(address.taluka);
      const st = cleanPlaceName(address.state || address.region) || "Maharashtra";

      structuredAddress = {
        village: v,
        town: t,
        city: c,
        suburb: sub,
        district: dist,
        taluka: tal,
        state: st,
        postcode: address.postcode || address.postalCode || "",
        country: "India",
        placeType: "",
        placeClass: "",
        displayName: cleanAddressString(address.formattedAddress || address.displayName || ""),
      };
    }

    // Always reverse geocode using server polygons to get precise village / municipal boundary
    if (lat && lng) {
      try {
        const geo = await reverseGeocode(lat, lng);
        if (geo) {
          structuredAddress = {
            village: structuredAddress?.village || geo.village || "",
            town: structuredAddress?.town || geo.town || "",
            city: structuredAddress?.city || geo.city || "",
            suburb: structuredAddress?.suburb || geo.suburb || "",
            district: structuredAddress?.district && !/division/i.test(structuredAddress.district) ? structuredAddress.district : (geo.district && !/division/i.test(geo.district) ? geo.district : "Kolhapur"),
            taluka: structuredAddress?.taluka && !/division/i.test(structuredAddress.taluka) ? structuredAddress.taluka : (geo.taluka && !/division/i.test(geo.taluka) ? geo.taluka : ""),
            state: structuredAddress?.state || geo.state || "Maharashtra",
            postcode: structuredAddress?.postcode || geo.postcode || "",
            displayName: cleanAddressString(structuredAddress?.displayName || geo.displayName || ""),
          };
        }
      } catch (geoErr) {
        console.warn("Server reverse geocode failed:", geoErr.message);
      }
    }

    // Detect authority with coordinates passed
    const authorityResult = detectAuthority(structuredAddress, lat, lng);

    // Generate letter header
    const letterHeader = generateLetterHeader(authorityResult, structuredAddress);

    // Build clean display address without "Pune Division"
    const parts = [];
    if (structuredAddress) {
      const v = cleanPlaceName(structuredAddress.village);
      const sub = cleanPlaceName(structuredAddress.suburb);
      const t = cleanPlaceName(structuredAddress.town);
      const c = cleanPlaceName(structuredAddress.city);
      const dist = cleanPlaceName(structuredAddress.district) || "Kolhapur";
      const cleanDist = (!dist || /division|pune/i.test(dist)) ? "Kolhapur" : dist;
      const st = cleanPlaceName(structuredAddress.state) || "Maharashtra";

      if (v) parts.push(v);
      else if (sub) parts.push(sub);
      if (t && !parts.includes(t)) parts.push(t);
      if (c && !parts.includes(c) && !v) parts.push(c);
      if (cleanDist && !parts.includes(cleanDist)) parts.push(cleanDist);
      if (st && !parts.includes(st)) parts.push(st);
    }

    const cleanDisplay = cleanAddressString(parts.join(", ")) || "Kolhapur, Maharashtra";

    res.json({
      authorityType: authorityResult.authorityType,
      authorityTitle: authorityResult.authorityTitle,
      authorityBody: authorityResult.authorityBody,
      confidence: authorityResult.confidence,
      detectionMethod: authorityResult.detectionMethod,
      letterHeader,
      address: structuredAddress,
      displayAddress: cleanDisplay,
    });
  } catch (error) {
    console.error("Authority detection error:", error.message);
    res.status(500).json({ message: error.message });
  }
}

// ===================================================
// AUTHORITY LOCATION BINDING ROUTES
// ===================================================

// 1. POST /register (Super Admin only)
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, state, district, city, area } = req.body;
    
    if (role === "VILLAGE_ADMIN" && !area) {
      return res.status(400).json({ message: "Area is required for VILLAGE_ADMIN" });
    }

    const existing = await Authority.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAuthority = new Authority({
      name, email, password: hashedPassword, role, state, district, city, area
    });

    await newAuthority.save();
    res.status(201).json({ message: "Authority registered successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. POST /login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const authority = await Authority.findOne({ email });
    if (!authority) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, authority.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server configuration error: JWT_SECRET not set" });
    }

    const token = jwt.sign(
      { 
        id: authority._id, 
        role: authority.role,
        state: authority.state,
        district: authority.district,
        city: authority.city,
        area: authority.area
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, authority: { name: authority.name, role: authority.role, email: authority.email } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. GET /complaints
router.get("/complaints", protectAuthority, async (req, res) => {
  try {
    const auth = req.authority;
    const { status, authorityType, page = 1, limit = 10 } = req.query;

    let filter = {};
    if (auth.role === "SUPER_ADMIN") {
      filter = {}; // SUPER_ADMIN can see everything
    } else if (auth.role === "CITY_ADMIN") {
      filter = { 
        state: auth.state, 
        district: auth.district, 
        city: auth.city,
        authorityType: { $in: ["municipal_corporation", "municipal_council"] }
      };
    } else if (auth.role === "VILLAGE_ADMIN") {
      filter = { 
        state: auth.state, 
        district: auth.district, 
        city: auth.city, 
        area: auth.area,
        authorityType: "gram_panchayat"
      };
    }

    if (status) filter.status = status;
    if (authorityType) filter.authorityType = authorityType;

    const complaints = await Complaint.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json(complaints);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. PATCH /complaints/:id/status
router.patch("/complaints/:id/status", protectAuthority, async (req, res) => {
  try {
    const auth = req.authority;
    const { status } = req.body; // "In Progress", "Resolved"

    let filter = { _id: req.params.id };
    if (auth.role === "CITY_ADMIN") {
      filter = { 
        ...filter, 
        state: auth.state, 
        district: auth.district, 
        city: auth.city,
        authorityType: { $in: ["municipal_corporation", "municipal_council"] }
      };
    } else if (auth.role === "VILLAGE_ADMIN") {
      filter = { 
        ...filter, 
        state: auth.state, 
        district: auth.district, 
        city: auth.city, 
        area: auth.area,
        authorityType: "gram_panchayat"
      };
    }

    const complaint = await Complaint.findOne(filter);
    if (!complaint) return res.status(403).json({ message: "Complaint not found or out of jurisdiction" });

    complaint.status = status;
    if (status === "Resolved") complaint.resolvedAt = new Date();
    
    await complaint.save();
    res.json({ message: "Status updated", complaint });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. GET /dashboard/stats
router.get("/dashboard/stats", protectAuthority, async (req, res) => {
  try {
    const auth = req.authority;
    let filter = {};
    if (auth.role === "SUPER_ADMIN") {
      filter = {};
    } else if (auth.role === "CITY_ADMIN") {
      filter = { 
        state: auth.state, 
        district: auth.district, 
        city: auth.city,
        authorityType: { $in: ["municipal_corporation", "municipal_council"] }
      };
    } else if (auth.role === "VILLAGE_ADMIN") {
      filter = { 
        state: auth.state, 
        district: auth.district, 
        city: auth.city, 
        area: auth.area,
        authorityType: "gram_panchayat"
      };
    }

    const complaints = await Complaint.find(filter);
    
    const stats = {
      total: complaints.length,
      open: complaints.filter(c => c.status === "Pending").length,
      inProgress: complaints.filter(c => c.status === "In Progress").length,
      resolved: complaints.filter(c => c.status === "Resolved").length,
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
