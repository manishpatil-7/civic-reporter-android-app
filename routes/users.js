import express from "express";
import admin from "../config/firebaseAdmin.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const router = express.Router();

// 🚀 GET ALL USERS (Admin Only)
router.get("/", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    const users = [];
    usersSnapshot.forEach(doc => {
      users.push({ id: doc.id, ...doc.data() });
    });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 PROMOTE TO ADMIN (Admin Only)
router.put("/promote/:uid", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    
    await admin.firestore().collection('users').doc(uid).update({
      role: 'admin'
    });
    
    // Also set custom claims in Firebase Auth (optional, but good practice)
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    
    res.json({ message: 'User promoted to admin successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 DEMOTE TO CITIZEN (Admin Only)
router.put("/demote/:uid", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    
    // Prevent self-demotion
    if (uid === req.user.uid) {
      return res.status(400).json({ message: "Cannot demote yourself" });
    }
    
    await admin.firestore().collection('users').doc(uid).update({
      role: 'citizen'
    });
    
    await admin.auth().setCustomUserClaims(uid, { admin: false });
    
    res.json({ message: 'User demoted to citizen successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 POST ADMIN REQUEST (Citizen Only)
router.post("/request-admin", authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ message: "You are already an admin" });
    }
    
    // Create a request document
    await admin.firestore().collection('adminRequests').doc(req.user.uid).set({
      uid: req.user.uid,
      name: req.user.name,
      email: req.user.email,
      status: 'pending',
      requestedAt: new Date().toISOString()
    });
    
    // Also update user doc
    await admin.firestore().collection('users').doc(req.user.uid).update({
      adminRequestStatus: 'pending'
    });
    
    res.json({ message: 'Admin access request submitted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 GET ADMIN REQUESTS (Admin Only)
router.get("/admin-requests", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requestsSnapshot = await admin.firestore().collection('adminRequests').where('status', '==', 'pending').get();
    const requests = [];
    requestsSnapshot.forEach(doc => {
      requests.push({ id: doc.id, ...doc.data() });
    });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 APPROVE ADMIN REQUEST (Admin Only)
router.put("/admin-requests/:uid/approve", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    
    const batch = admin.firestore().batch();
    
    // 1. Update user role
    const userRef = admin.firestore().collection('users').doc(uid);
    batch.update(userRef, { role: 'admin', adminRequestStatus: 'approved' });
    
    // 2. Mark request as approved
    const reqRef = admin.firestore().collection('adminRequests').doc(uid);
    batch.update(reqRef, { status: 'approved', processedAt: new Date().toISOString(), processedBy: req.user.uid });
    
    await batch.commit();
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    
    res.json({ message: 'Request approved. User is now an admin.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 REJECT ADMIN REQUEST (Admin Only)
router.put("/admin-requests/:uid/reject", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    
    const batch = admin.firestore().batch();
    
    // 1. Update user status
    const userRef = admin.firestore().collection('users').doc(uid);
    batch.update(userRef, { adminRequestStatus: 'rejected' });
    
    // 2. Mark request as rejected
    const reqRef = admin.firestore().collection('adminRequests').doc(uid);
    batch.update(reqRef, { status: 'rejected', processedAt: new Date().toISOString(), processedBy: req.user.uid });
    
    await batch.commit();
    
    res.json({ message: 'Admin request rejected.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// ==============================
// 🏆 REPUTATION SYSTEM
// ==============================

// 🚀 GET USER REPUTATION (Admin or self)
router.get("/reputation/:uid", authMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: "User not found" });
    }

    const data = userDoc.data();
    res.json({
      uid,
      reputation: data.reputation || 100, // Start at 100
      validComplaints: data.validComplaints || 0,
      rejectedComplaints: data.rejectedComplaints || 0,
      spamComplaints: data.spamComplaints || 0,
      canSubmit: (data.reputation || 100) > -50,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 UPDATE REPUTATION (Admin Only) — called when admin verifies/rejects complaint
router.put("/reputation/:uid", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    const { action } = req.body; // 'valid', 'rejected', 'spam'

    const userRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: "User not found" });
    }

    const data = userDoc.data();
    let reputation = data.reputation || 100;
    let validComplaints = data.validComplaints || 0;
    let rejectedComplaints = data.rejectedComplaints || 0;
    let spamComplaints = data.spamComplaints || 0;

    switch (action) {
      case 'valid':
        reputation += 10;
        validComplaints += 1;
        break;
      case 'rejected':
        reputation -= 20;
        rejectedComplaints += 1;
        break;
      case 'spam':
        reputation -= 50;
        spamComplaints += 1;
        break;
      default:
        return res.status(400).json({ message: "Invalid action. Use 'valid', 'rejected', or 'spam'" });
    }

    await userRef.update({
      reputation,
      validComplaints,
      rejectedComplaints,
      spamComplaints,
    });

    res.json({
      message: `Reputation updated: ${action}`,
      reputation,
      validComplaints,
      rejectedComplaints,
      spamComplaints,
      canSubmit: reputation > -50,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 CHECK IF USER CAN SUBMIT (Reputation check)
router.get("/can-submit/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.json({ canSubmit: true, reputation: 100 }); // New users can submit
    }

    const data = userDoc.data();
    const reputation = data.reputation || 100;
    
    res.json({
      canSubmit: reputation > -50,
      reputation,
    });
  } catch (error) {
    res.json({ canSubmit: true, reputation: 100 });
  }
});

export default router;
