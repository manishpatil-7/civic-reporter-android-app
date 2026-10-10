import mongoose from "mongoose";

const authoritySchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ["SUPER_ADMIN", "CITY_ADMIN", "VILLAGE_ADMIN"],
    required: true
  },
  state: { type: String, required: true },
  district: { type: String, required: true },
  city: { type: String, required: true },
  area: { 
    type: String, 
    required: function() { return this.role === "VILLAGE_ADMIN"; } 
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Authority = mongoose.model("Authority", authoritySchema);
export default Authority;
