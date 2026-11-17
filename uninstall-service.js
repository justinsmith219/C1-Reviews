// Removes the Windows Service. Run with: `node bin/uninstall-service.js`
const { Service } = require("node-windows");
const path = require("path");

const svc = new Service({
  name: "C1ReviewsCampaignManager",
  script: path.join(__dirname, "..", "server", "dist", "index.js"),
});
svc.on("uninstall", () => console.log("Service uninstalled."));
svc.uninstall();
