// One-time: registers the Node app as a Windows Service via node-windows.
// Run on the prod server with: `node bin/install-service.js`
//
// Subsequent updates do NOT require re-running this; just stop/start the
// service after deploying new files.

const { Service } = require("node-windows");
const path = require("path");

const svc = new Service({
  name: "C1ReviewsCampaignManager",
  description: "Zinnia Campaign Manager (Conductor1 access reviews dashboard)",
  // Run the built server entry. server/src/index.ts compiles to server/dist/index.js
  script: path.join(__dirname, "..", "server", "dist", "index.js"),
  nodeOptions: ["--max-old-space-size=2048"],
  workingDirectory: path.join(__dirname, ".."),
  // Inherit the .env file via dotenv (loaded inside the app)
  env: [
    { name: "NODE_ENV", value: "production" },
  ],
});

svc.on("install", () => {
  console.log("Service installed. Starting…");
  svc.start();
});
svc.on("alreadyinstalled", () => console.log("Service already installed."));
svc.on("start", () => console.log("Service started."));
svc.on("error", (err) => console.error("Service error:", err));

svc.install();
