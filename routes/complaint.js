import express from "express";
import Complaint from "../models/Complaint.js";
import Notification from "../models/Notification.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import sendEmail from "../utils/sendEmail.js";

const router = express.Router();


// 🚀 GET ALL COMPLAINTS
router.get("/", async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ createdAt: -1 });

    const mapped = complaints.map(c => {
      const doc = c.toJSON();
      return {
        ...doc,
        locationAddress: doc.location?.address || '',
        id: doc._id,
      };
    });

    res.json(mapped);
  } catch (error) {
    console.error("GET ALL ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});


// 🚀 GET USER COMPLAINTS
router.get("/user/:userId", async (req, res) => {
  try {
    const complaints = await Complaint.find({
      userId: req.params.userId
    }).sort({ createdAt: -1 });

    const mapped = complaints.map(c => {
      const doc = c.toJSON();
      return {
        ...doc,
        locationAddress: doc.location?.address || '',
        id: doc._id,
      };
    });

    res.json(mapped);
  } catch (error) {
    console.error("GET USER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});


// 🚀 GET BY ID
router.get("/:id", async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({ message: "Not found" });
    }

    const doc = complaint.toJSON();

    res.json({
      ...doc,
      locationAddress: doc.location?.address || '',
      id: doc._id,
    });
  } catch (error) {
    console.error("GET BY ID ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});


// 🚀 CREATE COMPLAINT (with Rate Limiting, Image Validation, Location Verification)
router.post("/", async (req, res) => {
  try {

    const {
      imageUrl,
      problemType,
      severity,
      description,
      hindiDescription,
      formalLetter,
      userId,
      userName,
      userEmail,
      location,
      department,
      imageValidation,
      categoryMatch,
      userLocation, // user's actual GPS position
      state,
      district,
      city,
      area,
      authorityType,
      authorityBody,
      locationSource,
      embedding, // AI-generated vector for duplicate detection
    } = req.body;

    // ✅ SAFE USER (no crash)
    const safeUserId = userId || req.user?.uid || "anonymous";
    const safeUserName = userName || req.user?.name || "Anonymous";

    // ✅ VALIDATION
    if (!problemType || !description) {
      return res.status(400).json({
        message: "problemType and description are required"
      });
    }

    // ✅ RATE LIMITING — Max 5 complaints per day per user
    if (safeUserId !== "anonymous") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayCount = await Complaint.countDocuments({
        userId: safeUserId,
        createdAt: { $gte: today }
      });

      if (todayCount >= 5) {
        return res.status(429).json({
          message: "Rate limit exceeded. You can submit a maximum of 5 complaints per day.",
          dailyLimit: 5,
          currentCount: todayCount,
        });
      }
    }

    // ✅ LOCATION HANDLING
    let locationData;
    if (location && location.lat && location.lng) {
      locationData = {
        lat: location.lat,
        lng: location.lng,
        address: location.address || '',
      };
    } else {
      locationData = {
        lat: 28.6139,
        lng: 77.2090,
        address: '',
      };
    }

    // ✅ LOCATION VERIFICATION — Compare user GPS vs complaint location
    let locationVerified = false;
    let locationDistance = 0;
    
    if (userLocation && userLocation.lat && userLocation.lng && locationData.lat && locationData.lng) {
      // Haversine formula for distance in km
      const R = 6371; // Earth's radius in km
      const dLat = (locationData.lat - userLocation.lat) * Math.PI / 180;
      const dLng = (locationData.lng - userLocation.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(locationData.lat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      locationDistance = R * c;
      
      // Verified if within 50km radius
      locationVerified = locationDistance <= 50;
    }

    // ✅ DETERMINE SPAM STATUS BASED ON AI VALIDATION
    let spamStatus = "clean";
    let flagReason = "";
    
    if (imageValidation && !imageValidation.isValid) {
      spamStatus = "flagged";
      flagReason = `Invalid image: ${imageValidation.reason || imageValidation.detectedContent}`;
    } else if (categoryMatch && !categoryMatch.matches) {
      spamStatus = "flagged";
      flagReason = `Category mismatch: Image shows "${categoryMatch.imageCategory}" but user selected "${categoryMatch.selectedCategory}"`;
    } else if (!locationVerified && locationDistance > 50) {
      spamStatus = "flagged";
      flagReason = `User is ${Math.round(locationDistance)}km away from complaint location`;
    }

    // ✅ CREATE OBJECT
    const complaint = new Complaint({
      imageUrl: imageUrl || "",
      problemType,
      severity: severity || "medium",
      description,
      hindiDescription,
      formalLetter,
      userId: safeUserId,
      userName: safeUserName,
      userEmail: userEmail || req.user?.email || "",
      department: department || "General Municipal Department",
      location: locationData,
      state: state || "",
      district: district || "",
      city: city || "",
      area: area || "",
      authorityType: authorityType || "municipal_corporation",
      authorityBody: authorityBody || "",
      locationSource: locationSource || "",
      imageValidation: imageValidation || {},
      categoryMatch: categoryMatch || {},
      locationVerified,
      locationDistance: Math.round(locationDistance * 100) / 100,
      spamStatus,
      flagReason,
      verificationStatus: spamStatus === "flagged" ? "Suspicious" : "Pending",
      // Store the embedding if provided (from duplicate check step)
      ...(embedding && embedding.length > 0 ? { embedding } : {}),
    });

    // ✅ SAVE
    const saved = await complaint.save();

    const doc = saved.toJSON();

    res.status(201).json({
      ...doc,
      locationAddress: doc.location?.address || '',
      id: doc._id,
    });

  } catch (error) {
    console.error("❌ CREATE ERROR:", error);
    res.status(500).json({
      message: error.message || "Server error"
    });
  }
});


// 🚀 UPVOTE
router.patch("/:id/upvote", authMiddleware, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Not found" });

    const userId = req.user.uid;
    const hasUpvoted = complaint.upvotedBy.includes(userId);

    if (hasUpvoted) {
      complaint.upvotedBy = complaint.upvotedBy.filter(id => id !== userId);
      complaint.upvotes = Math.max(0, complaint.upvotes - 1);
    } else {
      complaint.upvotedBy.push(userId);
      complaint.upvotes += 1;
    }

    const updated = await complaint.save();
    const doc = updated.toJSON();

    res.json({
      ...doc,
      locationAddress: doc.location?.address || '',
      id: doc._id,
    });
  } catch (error) {
    console.error("UPVOTE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// 🚀 UPDATE
router.patch("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Not found" });

    const oldStatus = complaint.status;
    const { status, verificationStatus, adminRemarks, afterImageUrl, spamStatus, flagReason } = req.body;
    let emailSentStatus = null;
    let emailErrorMessage = null;

    if (status) complaint.status = status;
    if (verificationStatus) complaint.verificationStatus = verificationStatus;
    if (afterImageUrl !== undefined) complaint.afterImageUrl = afterImageUrl;
    if (spamStatus) complaint.spamStatus = spamStatus;
    if (flagReason !== undefined) complaint.flagReason = flagReason;

    if (status && status !== oldStatus) {
      complaint.timeline.push({
        status,
        updatedBy: req.user?.name || "Admin",
        remarks: adminRemarks || `Status updated to ${status}`,
        timestamp: new Date()
      });

      if (complaint.userId) {
        await Notification.create({
          userId: complaint.userId,
          message: `Your complaint "${complaint.problemType}" is now ${status}.`,
          type: 'status_update',
          complaintId: complaint._id
        });
      }

      // SEND EMAIL NOTIFICATION IF RESOLVED
      if (status === "Resolved" && complaint.userEmail) {
        try {
          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Complaint Resolved</title>
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 40px 0;">
                    <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                      <!-- Header -->
                      <tr>
                        <td style="padding: 30px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0; text-align: center;">
                          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">✅ Complaint Resolved</h1>
                        </td>
                      </tr>
                      
                      <!-- Body -->
                      <tr>
                        <td style="padding: 40px;">
                          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                            Dear <strong>${complaint.userName}</strong>,
                          </p>
                          
                          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
                            We are pleased to inform you that your complaint has been successfully <strong style="color: #22c55e;">RESOLVED</strong>.
                          </p>
                          
                          <!-- Complaint Details Box -->
                          <table role="presentation" style="width: 100%; background-color: #f8fafc; border-radius: 8px; margin: 25px 0;">
                            <tr>
                              <td style="padding: 25px;">
                                <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Complaint Details</h3>
                                
                                <table role="presentation" style="width: 100%;">
                                  <tr>
                                    <td style="padding: 8px 0; color: #64748b; font-size: 14px; width: 120px;">Issue Type:</td>
                                    <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${complaint.problemType}</td>
                                  </tr>
                                  <tr>
                                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Location:</td>
                                    <td style="padding: 8px 0; color: #1e293b; font-size: 14px;">${complaint.location?.address || 'Not specified'}</td>
                                  </tr>
                                  <tr>
                                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Submitted:</td>
                                    <td style="padding: 8px 0; color: #1e293b; font-size: 14px;">${new Date(complaint.createdAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                                  </tr>
                                  <tr>
                                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Resolved:</td>
                                    <td style="padding: 8px 0; color: #22c55e; font-size: 14px; font-weight: 600;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                          
                          ${complaint.afterImageUrl ? `
                          <!-- Resolution Evidence -->
                          <table role="presentation" style="width: 100%; margin: 25px 0;">
                            <tr>
                              <td style="padding: 0;">
                                <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 16px;">📸 Resolution Evidence</h3>
                                <table role="presentation" style="width: 100%;">
                                  <tr>
                                    ${complaint.imageUrl ? `
                                    <td style="width: 48%; vertical-align: top; padding-right: 2%;">
                                      <p style="color: #64748b; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase;">Before (Reported)</p>
                                      <img src="${complaint.imageUrl}" alt="Before" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" />
                                    </td>
                                    ` : ''}
                                    <td style="width: ${complaint.imageUrl ? '48%' : '100%'}; vertical-align: top; ${complaint.imageUrl ? 'padding-left: 2%;' : ''}">
                                      <p style="color: #22c55e; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase;">✅ After (Resolved)</p>
                                      <img src="${complaint.afterImageUrl}" alt="After" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; border: 2px solid #22c55e;" />
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                          ` : (complaint.imageUrl ? `
                          <!-- Original Complaint Image -->
                          <table role="presentation" style="width: 100%; margin: 25px 0;">
                            <tr>
                              <td style="padding: 0;">
                                <p style="color: #64748b; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase;">Reported Issue</p>
                                <img src="${complaint.imageUrl}" alt="Issue" style="width: 100%; max-height: 250px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" />
                              </td>
                            </tr>
                          </table>
                          ` : '')}

                          <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 25px 0;">
                            Thank you for bringing this issue to our attention. Your active participation helps us build a better community for everyone.
                          </p>
                          
                          <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 25px 0;">
                            If you have any further concerns, please don't hesitate to reach out.
                          </p>
                        </td>
                      </tr>
                      
                      <!-- Footer -->
                      <tr>
                        <td style="padding: 30px 40px; background-color: #f8fafc; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e2e8f0;">
                          <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">Best regards,</p>
                          <p style="color: #1e293b; font-size: 16px; font-weight: 600; margin: 0;">Civic Reporter Support Team</p>
                          <p style="color: #94a3b8; font-size: 12px; margin: 20px 0 0 0;">This is an automated notification. Please do not reply to this email.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
            </html>
          `;
          await sendEmail(complaint.userEmail, "✅ Complaint Resolved Successfully - Civic Reporter", emailHtml);
          console.log(`✅ Resolution email sent to ${complaint.userEmail}`);
          emailSentStatus = true;
        } catch (emailError) {
          console.error("❌ Failed to send resolution email:", emailError.message);
          emailSentStatus = false;
          emailErrorMessage = emailError.message;
          // Don't throw - let the update continue even if email fails
        }
      }
    }

    const updated = await complaint.save();
    const doc = updated.toJSON();

    res.json({
      ...doc,
      locationAddress: doc.location?.address || '',
      id: doc._id,
      emailSent: emailSentStatus,
      emailError: emailErrorMessage,
    });

  } catch (error) {
    console.error("UPDATE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});


// 🚀 MANUAL EMAIL TRIGGER (Admin only)
router.post("/:id/send-email", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    const { emailType = 'status_update', customMessage = '', targetEmail } = req.body;
    
    const emailToSend = targetEmail || complaint.userEmail;

    if (!emailToSend) {
      return res.status(400).json({ message: "No user email associated with this complaint" });
    }

    // Different email templates based on type
    let subject, emailHtml;

    if (emailType === 'resolved') {
      subject = "✅ Complaint Resolved - Civic Reporter";
      emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Complaint Resolved</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="padding: 30px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">✅ Complaint Resolved</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px;">
                      <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Dear <strong>${complaint.userName}</strong>,</p>
                      <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">We are pleased to inform you that your complaint has been successfully <strong style="color: #22c55e;">RESOLVED</strong>.</p>
                      <table role="presentation" style="width: 100%; background-color: #f8fafc; border-radius: 8px; margin: 25px 0;">
                        <tr><td style="padding: 25px;">
                          <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Complaint Details</h3>
                          <table role="presentation" style="width: 100%;">
                            <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px; width: 120px;">Issue Type:</td><td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${complaint.problemType}</td></tr>
                            <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Location:</td><td style="padding: 8px 0; color: #1e293b; font-size: 14px;">${complaint.location?.address || 'Not specified'}</td></tr>
                            <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Submitted:</td><td style="padding: 8px 0; color: #1e293b; font-size: 14px;">${new Date(complaint.createdAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
                          </table>
                        </td></tr>
                      </table>
                      ${customMessage ? `<p style="color: #555; font-size: 15px; line-height: 1.6; margin: 25px 0; background: #f0fdf4; padding: 15px; border-radius: 8px; border-left: 4px solid #22c55e;"><strong>Admin Message:</strong> ${customMessage}</p>` : ''}
                      
                      ${complaint.afterImageUrl ? `
                      <!-- Resolution Evidence -->
                      <table role="presentation" style="width: 100%; margin: 25px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 16px;">📸 Resolution Evidence</h3>
                            <table role="presentation" style="width: 100%;">
                              <tr>
                                ${complaint.imageUrl ? `
                                <td style="width: 48%; vertical-align: top; padding-right: 2%;">
                                  <p style="color: #64748b; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase;">Before (Reported)</p>
                                  <img src="${complaint.imageUrl}" alt="Before" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" />
                                </td>
                                ` : ''}
                                <td style="width: ${complaint.imageUrl ? '48%' : '100%'}; vertical-align: top; ${complaint.imageUrl ? 'padding-left: 2%;' : ''}">
                                  <p style="color: #22c55e; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase;">✅ After (Resolved)</p>
                                  <img src="${complaint.afterImageUrl}" alt="After" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; border: 2px solid #22c55e;" />
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      ` : (complaint.imageUrl ? `
                      <!-- Original Complaint Image -->
                      <table role="presentation" style="width: 100%; margin: 25px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <p style="color: #64748b; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; text-transform: uppercase;">Reported Issue</p>
                            <img src="${complaint.imageUrl}" alt="Issue" style="width: 100%; max-height: 250px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" />
                          </td>
                        </tr>
                      </table>
                      ` : '')}

                      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 25px 0;">Thank you for bringing this issue to our attention. Your active participation helps us build a better community.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 30px 40px; background-color: #f8fafc; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">Best regards,</p>
                      <p style="color: #1e293b; font-size: 16px; font-weight: 600; margin: 0;">Civic Reporter Support Team</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;
    } else {
      // Generic status update email
      subject = "📢 Complaint Status Update - Civic Reporter";
      emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Complaint Status Update</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="padding: 30px 40px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); border-radius: 12px 12px 0 0; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">📢 Status Update</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px;">
                      <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Dear <strong>${complaint.userName}</strong>,</p>
                      <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">Your complaint status has been updated to: <strong>${complaint.status}</strong></p>
                      <table role="presentation" style="width: 100%; background-color: #f8fafc; border-radius: 8px; margin: 25px 0;">
                        <tr><td style="padding: 25px;">
                          <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Complaint Details</h3>
                          <table role="presentation" style="width: 100%;">
                            <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px; width: 120px;">Issue Type:</td><td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${complaint.problemType}</td></tr>
                            <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Location:</td><td style="padding: 8px 0; color: #1e293b; font-size: 14px;">${complaint.location?.address || 'Not specified'}</td></tr>
                            <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Current Status:</td><td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${complaint.status}</td></tr>
                          </table>
                        </td></tr>
                      </table>
                      ${customMessage ? `<p style="color: #555; font-size: 15px; line-height: 1.6; margin: 25px 0; background: #eff6ff; padding: 15px; border-radius: 8px; border-left: 4px solid #3b82f6;"><strong>Message from Admin:</strong> ${customMessage}</p>` : ''}
                      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 25px 0;">Thank you for your patience. We will continue to work on resolving your complaint.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 30px 40px; background-color: #f8fafc; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">Best regards,</p>
                      <p style="color: #1e293b; font-size: 16px; font-weight: 600; margin: 0;">Civic Reporter Support Team</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;
    }

    await sendEmail(emailToSend, subject, emailHtml);
    
    res.json({ 
      success: true, 
      message: `Email sent successfully to ${emailToSend}`,
      emailType,
      sentAt: new Date()
    });

  } catch (error) {
    console.error("❌ SEND EMAIL ERROR:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to send email", 
      error: error.message 
    });
  }
});

// 🚀 DELETE
router.delete("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const deleted = await Complaint.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });

    res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("DELETE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;