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

  return {
    village: addr.village || addr.hamlet || addr.isolated_dwelling || "",
    town: addr.town || addr.borough || "",
    city: addr.city || addr.municipality || addr.city_district || "",
    suburb: addr.suburb || addr.neighbourhood || addr.residential || "",
    district: (addr.state_district || addr.county || addr.district || "").replace(/\s*district$/i, "").trim(),
    taluka: (addr.county || addr.subdistrict || addr.state_district || "").replace(/\s*taluka$/i, "").trim(),
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

  const state = bdc.principalSubdivision || "";
  const displayName = [cityOrTown, taluka, district, state].filter(Boolean).join(", ");

  return {
    village: bdc.locality || "",
    town: bdc.locality || "",
    city: cityOrTown || "",
    suburb: "",
    district: district || taluka || "",
    taluka: taluka || district || "",
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
  const normalized = normalize(placeName);
  if (!normalized) return null;

  for (const entry of dataset) {
    const entryName = normalize(entry.name);
    const allNames = [entryName, ...entry.aliases.map(normalize)];

    for (const name of allNames) {
      if (
        normalized === name ||
        normalized.includes(name) ||
        name.includes(normalized)
      ) {
        return entry;
      }
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
 * Main authority detection logic
 */
function detectAuthority(structuredAddress) {
  if (!structuredAddress) {
    return {
      authorityType: "municipal_corporation",
      authorityTitle: "The Municipal Officer",
      authorityBody: "Local Civic Authority",
      confidence: 30,
      detectionMethod: "fallback",
    };
  }

  const { village, town, city, suburb, district, state, placeType, displayName } = structuredAddress;

  // Strategy 1: Direct match against Municipal Corporations
  const cityNames = [city, town, suburb, village].filter(Boolean);
  for (const name of cityNames) {
    const corpMatch = matchInDataset(name, municipalCorporations);
    if (corpMatch) {
      return {
        authorityType: "municipal_corporation",
        authorityTitle: "The Municipal Commissioner",
        authorityBody: `Municipal Corporation ${corpMatch.name}`,
        confidence: 95,
        detectionMethod: "dataset_corporation",
        matchedEntry: corpMatch,
      };
    }
  }

  // Also check district name against corporations (e.g., "Kolhapur" district)
  if (district) {
    const corpByDistrict = matchInDataset(district, municipalCorporations);
    if (corpByDistrict && (!village && !town && !city || normalize(city) === normalize(corpByDistrict.name))) {
      return {
        authorityType: "municipal_corporation",
        authorityTitle: "The Municipal Commissioner",
        authorityBody: `Municipal Corporation ${corpByDistrict.name}`,
        confidence: 85,
        detectionMethod: "dataset_corporation_district",
        matchedEntry: corpByDistrict,
      };
    }
  }

  // Strategy 2: If Nominatim classifies as a village (no town/city), it's a Gram Panchayat
  if (village && !town && !city) {
    return {
      authorityType: "gram_panchayat",
      authorityTitle: "The Sarpanch",
      authorityBody: `Gram Panchayat ${village}`,
      confidence: 90,
      detectionMethod: "nominatim_village_field",
    };
  }

  // Strategy 3: Direct match against Municipal Councils (only for town/city areas)
  for (const name of cityNames) {
    const councilMatch = matchInDataset(name, municipalCouncils);
    if (councilMatch) {
      return {
        authorityType: "municipal_council",
        authorityTitle: "The Chief Officer",
        authorityBody: `Municipal Council ${councilMatch.name}`,
        confidence: 90,
        detectionMethod: "dataset_council",
        matchedEntry: councilMatch,
      };
    }
  }

  // If the location has a "town" field, it's likely a Municipal Council
  if (town && !city) {
    return {
      authorityType: "municipal_council",
      authorityTitle: "The Chief Officer",
      authorityBody: `Municipal Council ${town}`,
      confidence: 75,
      detectionMethod: "nominatim_town_field",
    };
  }

  // If the location has a "city" field, it could be a Municipal Corporation
  if (city) {
    return {
      authorityType: "municipal_corporation",
      authorityTitle: "The Municipal Commissioner",
      authorityBody: `Municipal Corporation ${city}`,
      confidence: 70,
      detectionMethod: "nominatim_city_field",
    };
  }

  // Default fallback — Gram Panchayat or Local Civic Authority
  const placeName = village || town || suburb || city || district || "Local Area";
  return {
    authorityType: "gram_panchayat",
    authorityTitle: "The Sarpanch",
    authorityBody: `Gram Panchayat ${placeName}`,
    confidence: 50,
    detectionMethod: "fallback_rural",
  };
}

/**
 * Generate the formal letter header based on authority
 */
function generateLetterHeader(authorityResult, structuredAddress) {
  const { authorityType, authorityTitle, authorityBody } = authorityResult;
  const addr = structuredAddress || {};

  if (authorityType === "gram_panchayat") {
    const villageName = addr.village || addr.town || addr.suburb || "Unknown";
    const talukaLine = addr.taluka ? `Taluka ${addr.taluka},\n` : "";
    const districtLine = addr.district ? `District ${addr.district}` : "";
    const stateLine = addr.state ? `, ${addr.state}` : "";

    return `To,\n${authorityTitle},\n${authorityBody},\n${talukaLine}${districtLine}${stateLine}`;
  }

  if (authorityType === "municipal_council") {
    const townName = addr.town || addr.city || addr.suburb || "Unknown";
    const districtLine = addr.district ? `\nDistrict ${addr.district}` : "";
    const stateLine = addr.state ? `, ${addr.state}` : "";

    return `To,\n${authorityTitle},\n${authorityBody},${districtLine}${stateLine}`;
  }

  // Municipal Corporation
  const cityName = addr.city || addr.town || "Unknown";
  const districtLine = addr.district ? `\nDistrict ${addr.district}` : "";
  const stateLine = addr.state ? `, ${addr.state}` : "";

  return `To,\n${authorityTitle},\n${authorityBody},${districtLine}${stateLine}`;
}

// ===================================================
// API ENDPOINT: POST /api/authority/detect
// ===================================================
router.post("/detect", async (req, res) => {
  try {
    const { lat, lng, address } = req.body;

    let structuredAddress = null;

    // If structured address components provided directly from mobile client
    if (address && typeof address === "object") {
      structuredAddress = {
        village: address.village || address.subLocality || address.name || "",
        town: address.town || "",
        city: address.city || "",
        suburb: address.suburb || address.district || "",
        district: address.district || address.city || "",
        taluka: address.taluka || address.subregion || address.district || "",
        state: address.state || address.region || "",
        postcode: address.postcode || address.postalCode || "",
        country: "India",
        placeType: "",
        placeClass: "",
        displayName: address.formattedAddress || address.displayName || "",
      };
    }

    // If lat/lng provided and address wasn't passed or is missing key fields, reverse geocode
    if ((!structuredAddress || (!structuredAddress.village && !structuredAddress.city)) && lat && lng) {
      const geo = await reverseGeocode(lat, lng);
      if (geo) {
        structuredAddress = { ...(structuredAddress || {}), ...geo };
      }
    }

    // Detect authority
    const authorityResult = detectAuthority(structuredAddress);

    // Generate letter header
    const letterHeader = generateLetterHeader(authorityResult, structuredAddress);

    // Build display address
    const parts = [];
    if (structuredAddress) {
      const { village, town, city, suburb, taluka, district, state } = structuredAddress;
      if (village) parts.push(village);
      else if (suburb) parts.push(suburb);
      if (town) parts.push(town);
      if (city) parts.push(city);
      if (taluka && !parts.includes(taluka)) parts.push(taluka);
      if (district && !parts.includes(district)) parts.push(district);
      if (state) parts.push(state);
    }

    res.json({
      authorityType: authorityResult.authorityType,
      authorityTitle: authorityResult.authorityTitle,
      authorityBody: authorityResult.authorityBody,
      confidence: authorityResult.confidence,
      detectionMethod: authorityResult.detectionMethod,
      letterHeader,
      address: structuredAddress,
      displayAddress: parts.join(", ") || "Unknown Location",
    });
  } catch (error) {
    console.error("Authority detection error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

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
