import admin from '../config/firebaseAdmin.js';
// We actually need to check the Firestore "users" collection from the backend
// Since Firebase Admin SDK is initialized, we can use it to query Firestore!

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Verify token using Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // We have the basic auth info (uid, email)
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    // To get the role, we must fetch the user document from Firestore (backend side)
    const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
    
    if (userDoc.exists) {
      req.user.role = userDoc.data().role || 'citizen';
      req.user.name = userDoc.data().name || 'User';
    } else {
      req.user.role = 'citizen'; // Default if doc doesn't exist
    }

    next();
  } catch (error) {
    console.error('Auth Error:', error.message);
    return res.status(401).json({ message: 'Unauthorized: Token verification failed' });
  }
};

export const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: Admin access required' });
  }

  next();
};
