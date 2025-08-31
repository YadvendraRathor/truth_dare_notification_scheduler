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
    const now = getIST(); // ✅ always IST
    console.log("⏰ Checking schedules at:", formatIST(now));

    const snapshot = await scheduleRef.once("value");
    const allSchedules = snapshot.val() || {};

    for (const id in allSchedules) {
      const task = allSchedules[id];
      const scheduledTime = parseISTTime(task.time);

      console.log(
        `📌 Task [${id}] -> scheduled: ${task.time}, parsed: ${formatIST(scheduledTime)}, sent: ${task.sent}`
      );

      if (!task.sent && scheduledTime <= now) {
        console.log(`🚀 Sending notification for task [${id}]`);

        await sendNotification(task.title, task.body, task.topic);

        // ✅ Mark as sent in DB
        await scheduleRef.child(id).update({ sent: true });
      }
    }
  } catch (err) {
    console.error("Error checking schedules:", err);
  }
}, 60 * 1000); // run every minute

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
      time: formatIST(getIST()), // ✅ save in IST
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

// Get all scheduled
app.get("/schedule", async (req, res) => {
  try {
    const snapshot = await scheduleRef.once("value");
    const data = snapshot.val() || {};
    res.json(Object.values(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit scheduled
app.put("/schedule/:id", async (req, res) => {
  const { id } = req.params;
  const { title, body, topic, time } = req.body;

  try {
    const snapshot = await scheduleRef.child(id).once("value");
    if (!snapshot.exists()) return res.status(404).json({ error: "Not found" });

    const normalizedTime = normalizeToIST(time);

    const updated = { id, title, body, topic: topic || "all", time: normalizedTime, sent: false };
    await scheduleRef.child(id).set(updated);

    res.json({ success: true, schedule: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete scheduled
app.delete("/schedule/:id", async (req, res) => {
  try {
    await scheduleRef.child(req.params.id).remove();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk schedule
app.post("/bulk-schedule", async (req, res) => {
  const { schedules: bulk } = req.body;

  if (!Array.isArray(bulk) || bulk.length === 0) {
    return res.status(400).json({ success: false, error: "Invalid schedules array" });
  }

  try {
    const created = [];

    for (const item of bulk) {
      const id = uuidv4();
      const normalizedTime = normalizeToIST(item.time);

      const schedule = {
        id,
        title: item.title,
        body: item.body,
        topic: item.topic || "all",
        time: normalizedTime,
        sent: false
      };

      await scheduleRef.child(id).set(schedule);

      await historyRef.push({
        title: schedule.title,
        body: schedule.body,
        topic: schedule.topic,
        time: schedule.time,
        type: "scheduled"
      });

      created.push(schedule);
    }

    res.json({ success: true, schedules: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---------------- HELPER FUNCTIONS ----------------

// Get IST Date object
function getIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // 5h30m in ms
  return new Date(now.getTime() + istOffset - now.getTimezoneOffset() * 60000);
}

// Format IST datetime as string
function formatIST(date) {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

// Normalize any input to IST string
function normalizeToIST(input) {
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    throw new Error("Invalid time format");
  }
  return formatIST(parsed);
}

// Parse IST time string back to Date
function parseISTTime(str) {
  return new Date(new Date(str).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
