import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load either from an env variable (JSON string) or the downloaded file
let serviceAccount;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  } else {
    // Look for the file we copied
    const keyPath = join(__dirname, '..', 'serviceAccountKey.json');
    if (existsSync(keyPath)) {
      serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    } else {
      throw new Error("Missing Firebase Service Account Key. Cannot initialize admin SDK.");
    }
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  console.log("Firebase Admin SDK initialized ✅");
} catch (error) {
  console.error("Firebase Admin SDK initialization failed ❌");
  console.error(error.message);
}

export default admin;
