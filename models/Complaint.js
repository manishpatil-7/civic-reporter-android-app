import mongoose from "mongoose";

const complaintSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
  },

  afterImageUrl: {
    type: String,
  },

  problemType: {
    type: String,
    default: "Other",
  },

  severity: {
    type: String,
    enum: ["Low", "Medium", "High"],
    default: "Medium",
  },

  priority: {
    type: Number,
    default: 0,
  },

  description: {
    type: String,
  },

  formalLetter: {
    type: String,
  },

  hindiDescription: {
    type: String,
  },

  // User who submitted
  userId: {
    type: String,
    default: "",
  },

  userName: {
    type: String,
    default: "Anonymous",
  },

  userEmail: {
    type: String,
  },

  // Smart department suggestion
  department: {
    type: String,
    default: "General Municipal Department",
  },

  // Authority detection
  authorityType: {
    type: String,
    enum: ["gram_panchayat", "municipal_council", "municipal_corporation"],
    default: "municipal_corporation",
  },

  authorityBody: {
    type: String,
    default: "",
  },

  // Translated version of the formal letter
  translatedLetter: {
    type: String,
    default: "",
  },

  translatedLanguage: {
    type: String,
    default: "",
  },

  location: {
    lat: Number,
    lng: Number,
    address: String,
  },

  status: {
    type: String,
    enum: ["Pending", "In Progress", "Resolved", "Escalated"],
    default: "Pending"
  },
  state: { type: String },
  district: { type: String },
  city: { type: String },
  area: { type: String },
  locationSource: {
    type: String,
    enum: ["EXIF_GPS", "PLUS_CODE", "ADDRESS_STRING", "MANUAL", "BROWSER_GPS", ""],
    default: "",
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Authority' },
  escalatedAt: { type: Date },
  resolvedAt: { type: Date },

  upvotes: {
    type: Number,
    default: 0,
  },

  upvotedBy: {
    type: [String],
    default: [],
  },

  timeline: {
    type: [{
      status: String,
      updatedBy: String,
      remarks: String,
      timestamp: { type: Date, default: Date.now }
    }],
    default: []
  },

  verificationStatus: {
    type: String,
    enum: ["Pending", "Verified", "Suspicious", "Rejected", "Approved manually", "Rejected manually", "Spam"],
    default: "Pending" // Will be updated by AI or Admin
  },
  
  verificationConfidence: {
    type: Number,
    default: 0
  },

  // Image validation - whether the image shows a valid civic issue
  imageValidation: {
    isValid: { type: Boolean, default: true },
    reason: { type: String, default: "" },
    detectedContent: { type: String, default: "" },
  },

  // Category match - AI cross-check between image and selected category
  categoryMatch: {
    matches: { type: Boolean, default: true },
    imageCategory: { type: String, default: "" },
    selectedCategory: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
  },

  // Location verification
  locationVerified: {
    type: Boolean,
    default: false,
  },

  locationDistance: {
    type: Number, // distance in km between user and complaint location
    default: 0,
  },

  // Spam/Flag system
  flagReason: {
    type: String,
    default: "",
  },

  spamStatus: {
    type: String,
    enum: ["clean", "flagged", "spam"],
    default: "clean",
  },

  // AI-generated text embedding vector for duplicate detection
  embedding: {
    type: [Number],
    default: [],
    select: false, // Exclude from default queries (large array) — fetch explicitly when needed
  },

  // YOLO neural detections (bounding boxes, confidence, label)
  detections: {
    type: Array,
    default: [],
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-add "Pending" to timeline before saving for the first time
complaintSchema.pre('save', function() {
  if (this.isNew && this.timeline.length === 0) {
    this.timeline.push({
      status: this.status || 'Pending',
      updatedBy: 'System',
      remarks: 'Complaint logged into the system.',
      timestamp: new Date()
    });
  }
});

// Virtual field for location array for map rendering [lat, lng]
complaintSchema.virtual('locationArray').get(function() {
  if (this.location && this.location.lat && this.location.lng) {
    return [this.location.lat, this.location.lng];
  }
  return [28.6139 + (Math.random() - 0.5) * 0.05, 77.2090 + (Math.random() - 0.5) * 0.05];
});

// Ensure virtuals are included in JSON responses
complaintSchema.set('toJSON', { virtuals: true });
complaintSchema.set('toObject', { virtuals: true });

const Complaint = mongoose.model("Complaint", complaintSchema);


export default Complaint;