import express from "express";
import multer from "multer";
import exifr from "exifr";
import axios from "axios";

const router = express.Router();

// Use memory storage — no disk writes, process buffer directly
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// Plus Code regex pattern
const PLUS_CODE_REGEX = /[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}/i;

// Nominatim headers (required by ToS)
const NOMINATIM_HEADERS = {
  "User-Agent": "SmartCivicReporter/1.0 (civic-reporter-app)",
};

// Helper: delay to respect Nominatim rate limit (1 req/sec)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reverse geocode lat/lng → structured address using Nominatim
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=en`;
    const { data } = await axios.get(url, { headers: NOMINATIM_HEADERS });

    if (!data || !data.address) return null;

    const addr = data.address;
    return {
      state: addr.state || "",
      district: addr.county || addr.state_district || "",
      city: addr.city || addr.town || addr.village || "",
      area: addr.suburb || addr.neighbourhood || addr.hamlet || "",
      fullAddress: data.display_name || "",
      village: addr.village || "",
      town: addr.town || "",
      postcode: addr.postcode || "",
    };
  } catch (err) {
    console.error("❌ Reverse geocode error:", err.message);
    return null;
  }
}

/**
 * Forward geocode address string → lat/lng using Nominatim
 */
async function forwardGeocode(addressStr) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      addressStr
    )}&format=json&limit=1&accept-language=en`;
    const { data } = await axios.get(url, { headers: NOMINATIM_HEADERS });

    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
    return null;
  } catch (err) {
    console.error("❌ Forward geocode error:", err.message);
    return null;
  }
}

/**
 * Decode Plus Code to lat/lng using Google's Plus Codes API (free endpoint)
 */
async function decodePlusCode(plusCode) {
  try {
    // Try the plus.codes public API
    const url = `https://plus.codes/api?address=${encodeURIComponent(plusCode)}&ekey=none`;
    const { data } = await axios.get(url, { timeout: 5000 });

    if (data && data.geometry && data.geometry.location) {
      return {
        lat: data.geometry.location.lat,
        lng: data.geometry.location.lng,
      };
    }

    // Fallback: try Nominatim with Plus Code as search query
    return await forwardGeocode(plusCode);
  } catch (err) {
    console.error("❌ Plus Code decode error:", err.message);
    // Fallback: try Nominatim
    try {
      return await forwardGeocode(plusCode);
    } catch {
      return null;
    }
  }
}

/**
 * Search all EXIF text fields for a Plus Code
 */
function findPlusCode(exif) {
  if (!exif) return null;

  const fieldsToCheck = [
    exif.ImageDescription,
    exif.UserComment,
    exif.XPComment,
    exif.XPKeywords,
    exif.XPSubject,
    exif.title,
    exif.description,
    exif.subject,
  ];

  for (const field of fieldsToCheck) {
    if (!field) continue;
    const str = typeof field === "string" ? field : String(field);
    const match = str.match(PLUS_CODE_REGEX);
    if (match) {
      console.log(`📍 Plus Code found in EXIF field: "${match[0]}"`);
      return match[0];
    }
  }
  return null;
}

/**
 * Search EXIF fields for an address-like string
 */
function findAddressString(exif) {
  if (!exif) return null;

  const fieldsToCheck = [
    exif.ImageDescription,
    exif.UserComment,
    exif.XPComment,
    exif.XPSubject,
    exif.title,
    exif.description,
  ];

  for (const field of fieldsToCheck) {
    if (!field) continue;
    const str = typeof field === "string" ? field : String(field);
    // Basic heuristic: at least 10 chars, contains comma or numbers (address-like)
    if (str.length >= 10 && (str.includes(",") || /\d/.test(str))) {
      // Skip if it's only a Plus Code
      if (PLUS_CODE_REGEX.test(str) && str.replace(PLUS_CODE_REGEX, "").trim().length < 5) continue;
      console.log(`📍 Address string found in EXIF: "${str.substring(0, 80)}..."`);
      return str;
    }
  }
  return null;
}

// ===================================================
// POST /api/location/extract — Extract location from image EXIF
// ===================================================
router.post("/extract", memUpload.single("image"), async (req, res) => {
  console.log("📍 LOCATION EXTRACT ROUTE HIT ✅");

  try {
    if (!req.file) {
      return res.status(400).json({ found: false, message: "No image file provided" });
    }

    console.log(`📍 Processing image: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

    // Parse EXIF from buffer
    let exif = null;
    try {
      exif = await exifr.parse(req.file.buffer, {
        gps: true,
        tiff: true,
        xmp: true,
        iptc: true,
        ifd0: true,
        ifd1: false,
        exif: true,
        interop: false,
        makerNote: false,
      });
    } catch (exifErr) {
      console.log("⚠️ EXIF parsing failed (no metadata):", exifErr.message);
    }

    if (exif) {
      console.log("📍 EXIF data found. Keys:", Object.keys(exif).join(", "));
    } else {
      console.log("📍 No EXIF data in image");
    }

    // =============================================
    // PRIORITY 1: GPS from EXIF
    // =============================================
    if (exif && exif.latitude != null && exif.longitude != null) {
      const lat = exif.latitude;
      const lng = exif.longitude;
      console.log(`✅ PRIORITY 1 — EXIF GPS found: ${lat}, ${lng}`);

      const address = await reverseGeocode(lat, lng);

      return res.json({
        found: true,
        source: "EXIF_GPS",
        latitude: lat,
        longitude: lng,
        address: address || {
          state: "",
          district: "",
          city: "",
          area: "",
          fullAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        },
      });
    }

    // =============================================
    // PRIORITY 2: Plus Code from EXIF
    // =============================================
    const plusCode = findPlusCode(exif);
    if (plusCode) {
      console.log(`🔍 PRIORITY 2 — Decoding Plus Code: ${plusCode}`);

      const coords = await decodePlusCode(plusCode);
      if (coords) {
        await sleep(1100); // Nominatim rate limit
        const address = await reverseGeocode(coords.lat, coords.lng);

        return res.json({
          found: true,
          source: "PLUS_CODE",
          latitude: coords.lat,
          longitude: coords.lng,
          plusCode,
          address: address || {
            state: "",
            district: "",
            city: "",
            area: "",
            fullAddress: plusCode,
          },
        });
      }
    }

    // =============================================
    // PRIORITY 3: Address string from EXIF
    // =============================================
    const addressStr = findAddressString(exif);
    if (addressStr) {
      console.log(`🔍 PRIORITY 3 — Geocoding address: "${addressStr.substring(0, 60)}..."`);

      await sleep(1100); // Nominatim rate limit
      const coords = await forwardGeocode(addressStr);

      if (coords) {
        await sleep(1100);
        const address = await reverseGeocode(coords.lat, coords.lng);

        return res.json({
          found: true,
          source: "ADDRESS_STRING",
          latitude: coords.lat,
          longitude: coords.lng,
          address: address || {
            state: "",
            district: "",
            city: "",
            area: "",
            fullAddress: addressStr,
          },
        });
      }
    }

    // =============================================
    // PRIORITY 4: Fallback — nothing found
    // =============================================
    console.log("📍 PRIORITY 4 — No location data found in image");
    return res.json({
      found: false,
      source: "NONE",
      message: "No location data found in image metadata",
    });
  } catch (error) {
    console.error("❌ Location extract error:", error.message);
    return res.json({
      found: false,
      source: "ERROR",
      message: error.message,
    });
  }
});

// ===================================================
// GET /api/location/reverse — Reverse geocode lat/lng
// ===================================================
router.get("/reverse", async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ message: "lat and lng query params required" });
    }

    const address = await reverseGeocode(parseFloat(lat), parseFloat(lng));

    if (!address) {
      return res.json({
        state: "",
        district: "",
        city: "",
        area: "",
        fullAddress: `${lat}, ${lng}`,
      });
    }

    res.json(address);
  } catch (error) {
    console.error("❌ Reverse geocode error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
