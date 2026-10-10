import express from "express";
import sendEmail from "../utils/sendEmail.js";

const router = express.Router();

// In-memory OTP store (key: email, value: { otp, expiresAt })
// In production, use Redis or MongoDB TTL collection
const otpStore = new Map();

// Clean expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (now > data.expiresAt) {
      otpStore.delete(email);
    }
  }
}, 5 * 60 * 1000);

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ SEND OTP
router.post("/send", async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Rate limit: max 3 OTPs per email per 10 minutes
    const existing = otpStore.get(email);
    if (existing && existing.attempts >= 3 && Date.now() - existing.firstAttempt < 10 * 60 * 1000) {
      return res.status(429).json({ 
        message: "Too many OTP requests. Please wait 10 minutes before trying again." 
      });
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store OTP
    otpStore.set(email, {
      otp,
      expiresAt,
      attempts: (existing?.attempts || 0) + 1,
      firstAttempt: existing?.firstAttempt || Date.now(),
      verified: false,
    });

    // Send OTP email
    const html = `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; background: linear-gradient(135deg, #0B0F19 0%, #1a1f35 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%); padding: 32px 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
            🏛️ Smart Civic Reporter
          </h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">
            Email Verification
          </p>
        </div>
        
        <!-- Body -->
        <div style="padding: 32px 24px;">
          <p style="color: #e2e8f0; font-size: 15px; margin: 0 0 8px;">
            Hello <strong style="color: #a855f7;">${name || 'there'}</strong>,
          </p>
          <p style="color: #94a3b8; font-size: 14px; margin: 0 0 24px; line-height: 1.6;">
            Please use the following verification code to complete your registration:
          </p>
          
          <!-- OTP Box -->
          <div style="background: rgba(139, 92, 246, 0.1); border: 2px dashed rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 24px; text-align: center; margin: 0 0 24px;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">
              Your OTP Code
            </p>
            <div style="font-size: 36px; font-weight: 800; letter-spacing: 12px; color: #a855f7; font-family: 'Courier New', monospace;">
              ${otp}
            </div>
          </div>
          
          <!-- Warning -->
          <div style="background: rgba(251, 146, 60, 0.1); border-left: 3px solid #fb923c; border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 0 0 24px;">
            <p style="color: #fb923c; font-size: 12px; margin: 0; font-weight: 600;">
              ⏱️ This code expires in 5 minutes
            </p>
            <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0;">
              Do not share this code with anyone.
            </p>
          </div>
          
          <p style="color: #64748b; font-size: 12px; margin: 0; line-height: 1.5;">
            If you didn't request this code, please ignore this email. Someone may have entered your email by mistake.
          </p>
        </div>
        
        <!-- Footer -->
        <div style="background: rgba(255,255,255,0.03); padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.05); text-align: center;">
          <p style="color: #475569; font-size: 11px; margin: 0;">
            © ${new Date().getFullYear()} Smart Civic Reporter — Making cities better, together.
          </p>
        </div>
      </div>
    `;

    await sendEmail(email, "🔐 Verify Your Email — Smart Civic Reporter", html);

    console.log(`✅ OTP sent to ${email}: ${otp}`);

    res.json({ 
      message: "OTP sent successfully",
      expiresIn: 300, // 5 minutes in seconds
    });
  } catch (error) {
    console.error("❌ OTP send error:", error.message);
    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
});

// ✅ VERIFY OTP
router.post("/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const stored = otpStore.get(email);

    if (!stored) {
      return res.status(400).json({ 
        message: "No OTP found for this email. Please request a new one." 
      });
    }

    // Check expiry
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ 
        message: "OTP has expired. Please request a new one." 
      });
    }

    // Check OTP match
    if (stored.otp !== otp.toString()) {
      return res.status(400).json({ 
        message: "Invalid OTP. Please check and try again." 
      });
    }

    // Mark as verified
    stored.verified = true;
    otpStore.set(email, stored);

    console.log(`✅ OTP verified for ${email}`);

    res.json({ 
      message: "Email verified successfully! ✅",
      verified: true,
    });
  } catch (error) {
    console.error("❌ OTP verify error:", error.message);
    res.status(500).json({ message: "Verification failed. Please try again." });
  }
});

// ✅ CHECK IF EMAIL IS VERIFIED (called before Firebase signup)
router.get("/check/:email", (req, res) => {
  const { email } = req.params;
  const stored = otpStore.get(email);
  
  if (stored && stored.verified && Date.now() <= stored.expiresAt) {
    // Clean up after check
    otpStore.delete(email);
    return res.json({ verified: true });
  }
  
  res.json({ verified: false });
});

export default router;
