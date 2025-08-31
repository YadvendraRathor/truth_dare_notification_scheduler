const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

// ---------------- FIREBASE INIT ----------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://truth-and-dare-86f24-default-rtdb.firebaseio.com"
});

const db = admin.database();
const scheduleRef = db.ref("schedules");
const historyRef = db.ref("history");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------------- BACKGROUND CHECK ----------------
setInterval(async () => {
  try {
    const now = new Date(); // current UTC
    console.log("⏰ Checking schedules at:", now.toISOString());

    const snapshot = await scheduleRef.once("value");
    const allSchedules = snapshot.val() || {};

    for (const id in allSchedules) {
      const task = allSchedules[id];
      const scheduledTime = parseISTTime(task.time);

      console.log(
        `📌 Task [${id}] -> scheduled(raw): ${task.time}, parsed: ${scheduledTime.toISOString()}, sent: ${task.sent}`
      );

      if (!task.sent && scheduledTime <= now) {
        console.log(`🚀 Sending notification for task [${id}]`);
        await sendNotification(task.title, task.body, task.topic);

        await scheduleRef.child(id).update({ sent: true });
      }
    }
  } catch (err) {
    console.error("Error checking schedules:", err);
  }
}, 60 * 1000);

// ---------------- HELPER: SEND NOTIFICATION ----------------
async function sendNotification(title, body, topic) {
  try {
    const message = {
      notification: { title, body },
      topic: topic || "all",
    };

    const response = await admin.messaging().send(message);

    await historyRef.push({
      title,
      body,
      topic: topic || "all",
      time: getISTISOString(new Date()), // save in IST ISO format
      type: "sent"
    });

    return response;
  } catch (err) {
    console.error("Error sending notification:", err.message);
  }
}

// ---------------- API ROUTES ----------------

// Send immediately
app.post("/send-notification", async (req, res) => {
  try {
    const { title, body, topic } = req.body;
    const response = await sendNotification(title, body, topic);
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get history
app.get("/history", async (req, res) => {
  try {
    const snapshot = await historyRef.once("value");
    const data = snapshot.val() || {};
    res.json(Object.values(data).reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Schedule new notification
app.post("/schedule", async (req, res) => {
  const { title, body, topic, time } = req.body;
  const id = uuidv4();

  try {
    const normalizedTime = normalizeToIST(time);

    const schedule = { id, title, body, topic: topic || "all", time: normalizedTime, sent: false };
    await scheduleRef.child(id).set(schedule);

    await historyRef.push({
      title,
      body,
      topic: topic || "all",
      time: normalizedTime,
      type: "scheduled"
    });

    res.json({ success: true, schedule });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---------------- HELPER FUNCTIONS ----------------

// Convert a JS Date to IST ISO string
function getISTISOString(date) {
  return new Date(date.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().replace("Z", "+05:30");
}

// Normalize any input to IST ISO string
function normalizeToIST(input) {
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    throw new Error("Invalid time format");
  }
  return getISTISOString(parsed);
}

// Parse IST ISO back to Date
function parseISTTime(str) {
  return new Date(str); // works because str is ISO with +05:30
}

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
