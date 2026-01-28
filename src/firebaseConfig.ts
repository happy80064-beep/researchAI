import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// TODO: Replace with your actual Firebase project configuration
// You can find this in Firebase Console -> Project Settings -> General -> Your apps
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize only if config is valid to prevent crashes in dev if not set up
let db: any = null;
try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "REPLACE_WITH_YOUR_API_KEY") {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        console.log("Firebase initialized successfully");
    } else {
        console.warn("Firebase config not set. Falling back to LocalStorage.");
    }
} catch (e) {
    console.warn("Error initializing Firebase:", e);
}

export { db };