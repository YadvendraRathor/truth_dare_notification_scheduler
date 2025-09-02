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
    console.log("⏰ Checking schedules at (UTC):", now.toISOString(), " | (IST):", getISTISOString(now));

    const snapshot = await scheduleRef.once("value");
    const allSchedules = snapshot.val() || {};

    for (const id in allSchedules) {
      const task = allSchedules[id];
      const scheduledTime = new Date(task.time); // always UTC ISO

      console.log(
        `📌 Task [${id}] -> scheduled(UTC): ${scheduledTime.toISOString()}, scheduled(IST): ${getISTISOString(scheduledTime)}, sent: ${task.sent}`
      );

      if (!task.sent && scheduledTime <= now) {
        console.log(`🚀 Sending notification for task [${id}]`);
        console.log("🔍 Scheduled Task Data:", task); // 👈 log everything
        await sendNotification(task.title, task.body, task.topic,task.image);

        //await scheduleRef.child(id).update({ sent: true });
        await scheduleRef.child(id).remove();
      }
    }
  } catch (err) {
    console.error("Error checking schedules:", err);
  }
}, 60 * 1000);

// ---------------- HELPER: SEND NOTIFICATION ----------------
// ---------------- HELPER: SEND NOTIFICATION ----------------
async function sendNotification(title, body, topic, image) {
  try {
    const message = {
      notification: { title, body, image }, // 👈 add image here
      topic: topic || "all",
    };

    const response = await admin.messaging().send(message);

    // 👇 create a history record with id = Firebase key
    const ref = historyRef.push();
    await ref.set({
      id: ref.key,   // store the Firebase key as id
      title,
      body,
      topic: topic || "all",
      image: image || null,  // 👈 log the image too
      timeUTC: new Date().toISOString(),
      timeIST: getISTISOString(new Date()),
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
    const { title, body, topic, image } = req.body; // 👈 accept image
    const response = await sendNotification(title, body, topic, image);
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Get history
// Get history
app.get("/history", async (req, res) => {
  try {
    const snapshot = await historyRef.once("value");
    const data = snapshot.val() || {};

    const history = Object.entries(data).map(([id, item]) => ({
      id,            // preserve Firebase key
      ...item        // spread existing fields
    }));

    res.json(history.reverse()); // latest first
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all schedules (pending + sent)
app.get("/schedule", async (req, res) => {
  try {
    const snapshot = await scheduleRef.once("value");
    const data = snapshot.val() || {};
    const schedules = Object.values(data);
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a scheduled notification
app.put("/schedule/:id", async (req, res) => {
  const { id } = req.params;
  const { title, body, topic, time, image } = req.body;  // ✅ include image

  try {
    const normalizedTime = new Date(time).toISOString();

    const scheduleUpdate = {
      id,
      title,
      body,
      topic: topic || "all",
      time: normalizedTime,
      sent: false,
      image: image || null  // ✅ store image
    };

    await scheduleRef.child(id).update(scheduleUpdate);

    res.json({ success: true, schedule: scheduleUpdate });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


// Delete a scheduled notification
app.delete("/schedule/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await scheduleRef.child(id).remove();
    res.json({ success: true, message: `Schedule ${id} deleted` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


// Schedule new notification
// Schedule new notification
app.post("/schedule", async (req, res) => {
  const { title, body, topic, time, image } = req.body;

  try {
    const normalizedTime = new Date(time).toISOString(); // always UTC

    // Generate a Firebase key for this schedule
    const ref = scheduleRef.push();
    const id = ref.key;

    const schedule = { 
      id, 
      title, 
      body, 
      topic: topic || "all", 
      image: image || null,   // 👈 save image URL
      time: normalizedTime, 
      sent: false 
    };

    await ref.set(schedule);

    // Save to history with the same id
    const historyRefPush = historyRef.push();
    await historyRefPush.set({
      id: historyRefPush.key,
      title,
      body,
      topic: topic || "all",
      image: image || null,   // 👈 log image too
      timeUTC: normalizedTime,
      timeIST: getISTISOString(new Date(normalizedTime)),
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
  return new Date(date.getTime() + (5.5 * 60 * 60 * 1000))
    .toISOString()
    .replace("Z", "+05:30");
}


//Making server active
// Keep-alive / ping endpoint
app.get("/ping", (req, res) => {
  res.json({ status: "ok", message: "Server is active 🚀" });
});


// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
