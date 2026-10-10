/**
 * duplicate.js — Duplicate Complaint Detection API Routes
 * 
 * Provides AI-based semantic similarity detection for complaints.
 * When a user submits a complaint, this route checks for similar existing
 * complaints in the same location + category using vector embeddings.
 */

import express from "express";
import Complaint from "../models/Complaint.js";
import {
  generateEmbedding,
  buildEmbeddingText,
  findSimilarComplaints,
} from "../utils/similarity.js";

const router = express.Router();

// Configurable similarity threshold (0–1 scale)
const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.80");
const MAX_CANDIDATES = parseInt(process.env.MAX_CANDIDATES || "50");
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "7");

/**
 * POST /api/duplicates/check
 * 
 * Check for duplicate complaints before submission.
 * Uses AI embeddings + cosine similarity within the same location scope & category.
 * 
 * Body: { problemType, description, state, district, city, area }
 * 
 * Response:
 *   If duplicate found:  { duplicate: true, similarComplaints: [...] }
 *   If no duplicate:     { duplicate: false, embedding: [...] }
 */
router.post("/check", async (req, res) => {
  try {
    const { problemType, description, state, district, city, area } = req.body;

    // ✅ EDGE CASE: Skip AI check for very short complaints
    if (!description || description.trim().length < 15) {
      console.log("⏭️ Skipping duplicate check — description too short");
      return res.json({
        duplicate: false,
        embedding: null,
        skipped: true,
        reason: "Description too short for semantic comparison",
      });
    }

    // ✅ Step 1: Generate embedding for the new complaint
    const embeddingText = buildEmbeddingText(problemType, description);
    console.log("🧠 Generating embedding for:", embeddingText.substring(0, 80) + "...");
    
    const newEmbedding = await generateEmbedding(embeddingText);

    if (!newEmbedding) {
      console.warn("⚠️ Embedding generation failed — skipping duplicate check");
      return res.json({
        duplicate: false,
        embedding: null,
        skipped: true,
        reason: "Embedding generation failed",
      });
    }

    // ✅ Step 2: Build location filter — only compare within same location scope
    // To prevent strict string mismatch (e.g. "Pune" vs "Pune City" or missing DB fields),
    // we relax the location filter and rely on semantic similarity & recent timeframe.
    const locationFilter = {};
    // if (state) locationFilter.state = state;
    // if (district) locationFilter.district = district;
    // if (city) locationFilter.city = city;
    
    // ✅ Step 3: Category filter — only compare same problemType
    const categoryFilter = {};
    if (problemType && problemType !== "other" && problemType !== "None") {
      categoryFilter.problemType = problemType;
    }

    // ✅ Step 4: Time filter — only look at recent complaints (last N days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);

    // ✅ Step 5: Fetch candidates from MongoDB
    const query = {
      ...locationFilter,
      ...categoryFilter,
      createdAt: { $gte: cutoffDate },
      embedding: { $exists: true, $ne: [] }, // Only consider complaints with embeddings
      spamStatus: { $ne: "spam" }, // Exclude spam complaints
    };

    console.log("🔍 Searching candidates with filter:", JSON.stringify(query, null, 2));

    const candidates = await Complaint.find(query)
      .select("problemType description embedding upvotes upvotedBy imageUrl location state district city area status createdAt")
      .sort({ createdAt: -1 })
      .limit(MAX_CANDIDATES)
      .lean();

    console.log(`📊 Found ${candidates.length} candidate complaints to compare`);

    // ✅ Step 6: Find similar complaints using cosine similarity
    const similarResults = findSimilarComplaints(
      newEmbedding,
      candidates,
      SIMILARITY_THRESHOLD
    );



    if (similarResults.length > 0) {
      console.log(`⚠️ Found ${similarResults.length} similar complaints (threshold: ${SIMILARITY_THRESHOLD})`);

      const similarComplaints = similarResults.map(({ complaint, similarityScore }) => ({
        id: complaint._id,
        problemType: complaint.problemType,
        description: complaint.description?.substring(0, 200) + (complaint.description?.length > 200 ? "..." : ""),
        similarityScore,
        similarityPercent: Math.round(similarityScore * 100),
        upvotes: complaint.upvotes || 0,
        upvotedBy: complaint.upvotedBy || [],
        imageUrl: complaint.imageUrl || null,
        location: complaint.location || {},
        city: complaint.city || "",
        area: complaint.area || "",
        status: complaint.status || "OPEN",
        createdAt: complaint.createdAt,
      }));

      return res.json({
        duplicate: true,
        threshold: SIMILARITY_THRESHOLD,
        similarComplaints,
        embedding: newEmbedding, // Return so frontend can pass it to complaint creation
      });
    }

    // ✅ No duplicates found
    console.log("✅ No duplicates found — complaint is unique");
    return res.json({
      duplicate: false,
      embedding: newEmbedding,
    });

  } catch (error) {
    console.error("❌ Duplicate check error:", error);
    // Don't block complaint submission on duplicate check failure
    return res.json({
      duplicate: false,
      embedding: null,
      error: error.message,
    });
  }
});

/**
 * POST /api/duplicates/backfill-embeddings
 * 
 * Admin utility: Generate embeddings for existing complaints that don't have them.
 * This allows the duplicate detection to work with historical data.
 * 
 * Call this once to populate embeddings for old complaints.
 */
router.post("/backfill-embeddings", async (req, res) => {
  try {
    const complaints = await Complaint.find({
      $or: [
        { embedding: { $exists: false } },
        { embedding: [] },
        { embedding: null },
      ],
    })
      .select("problemType description")
      .limit(100) // Process in batches to avoid timeout
      .lean();

    console.log(`🔄 Backfilling embeddings for ${complaints.length} complaints...`);

    let updated = 0;
    let failed = 0;

    for (const complaint of complaints) {
      try {
        const text = buildEmbeddingText(complaint.problemType, complaint.description);
        const embedding = await generateEmbedding(text);

        if (embedding) {
          await Complaint.updateOne(
            { _id: complaint._id },
            { $set: { embedding } }
          );
          updated++;
        } else {
          failed++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`Failed to embed complaint ${complaint._id}:`, err.message);
        failed++;
      }
    }

    res.json({
      message: `Backfill complete: ${updated} updated, ${failed} failed, ${complaints.length} total processed`,
      updated,
      failed,
      total: complaints.length,
    });
  } catch (error) {
    console.error("❌ Backfill error:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
