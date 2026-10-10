/**
 * similarity.js — AI-based semantic similarity engine
 * 
 * Uses Google Gemini embedding model to convert complaint text into vectors,
 * then compares them using cosine similarity for duplicate detection.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use the text-embedding model (fallback to older ones if needed)
const EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Generate an embedding vector for a given text using Gemini
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
export async function generateEmbedding(text) {
  if (!text || text.trim().length < 10) {
    return null; // Skip very short text — unreliable embeddings
  }

  try {
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.error("❌ Embedding generation failed:", err.message);
    return null;
  }
}

/**
 * Compute cosine similarity between two vectors
 * Formula: similarity = dot(A, B) / (||A|| * ||B||)
 * 
 * @param {number[]} vecA - First embedding vector
 * @param {number[]} vecB - Second embedding vector
 * @returns {number} - Similarity score between 0 and 1
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);
}

/**
 * Build a composite text string for embedding from complaint fields
 * Combines title/problemType + description for richer semantic representation
 * 
 * @param {string} problemType - The complaint category / problem type
 * @param {string} description - The complaint description text
 * @returns {string} - Combined text for embedding
 */
export function buildEmbeddingText(problemType, description) {
  const parts = [];
  if (problemType && problemType !== "None" && problemType !== "other") {
    parts.push(`Issue type: ${problemType}`);
  }
  if (description) {
    parts.push(description);
  }
  return parts.join(". ");
}

/**
 * Find similar complaints using vector cosine similarity
 * 
 * @param {number[]} newEmbedding - Embedding of the new complaint
 * @param {Array} candidates - Array of existing complaint docs with embeddings
 * @param {number} threshold - Minimum similarity score (default 0.8)
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array} - Sorted array of { complaint, similarityScore }
 */
export function findSimilarComplaints(newEmbedding, candidates, threshold = 0.8, maxResults = 5) {
  if (!newEmbedding || !candidates || candidates.length === 0) return [];

  const results = [];

  for (const candidate of candidates) {
    // Skip candidates without embeddings
    if (!candidate.embedding || candidate.embedding.length === 0) continue;

    const score = cosineSimilarity(newEmbedding, candidate.embedding);

    if (score >= threshold) {
      results.push({
        complaint: candidate,
        similarityScore: Math.round(score * 100) / 100, // Round to 2 decimals
      });
    }
  }

  // Sort by similarity score (highest first), then by upvotes
  results.sort((a, b) => {
    if (b.similarityScore !== a.similarityScore) {
      return b.similarityScore - a.similarityScore;
    }
    return (b.complaint.upvotes || 0) - (a.complaint.upvotes || 0);
  });

  return results.slice(0, maxResults);
}


