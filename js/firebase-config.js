// =========================================================
// firebase-config.js — Configuration Firebase unique pour Yam
// =========================================================
//
// Source de vérité unique pour la config Firebase (projet projetyam-eddc1).
// Chargé par :
//   - spa-push.js (client)   → window.YAM_FIREBASE_CONFIG
//   - sw.js (Service Worker) → YAM_FIREBASE_CONFIG (via importScripts)
//
// ⚠️  Si le projet Firebase change, mets à jour UNIQUEMENT ce fichier.
// =========================================================

var YAM_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDdvlw8j9HTSbxRdir0L67v5XKdsellimY",
  authDomain: "projetyam-eddc1.firebaseapp.com",
  projectId: "projetyam-eddc1",
  storageBucket: "projetyam-eddc1.firebasestorage.app",
  messagingSenderId: "110051295714",
  appId: "1:110051295714:web:1cf81058bf2aa3016e79bb",
  measurementId: "G-SYF2XDG54K",
};

// Clé VAPID publique (utilisée par le client pour s'abonner aux push).
var YAM_VAPID_PUBLIC_KEY = "BJtX1Wj7pUoLl6ALPz_Izz1_0mrRGsg5StuNAY_sFpb8aoGZgesJv0o6AZ8pRCoQPjSr2a_yCiG1JyFN0XRh-fA";
