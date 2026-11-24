import express from "express";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { registerLLM } from "./llm";

config({ path: '.env.local' });
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3007;

  app.use(express.json({ limit: '2mb' }));
  registerLLM(app);

  // API Route for Semantic Search (Grep) with more context
  app.post("/api/grep", (req, res) => {
    const { keywords } = req.body;
    if (!keywords || !Array.isArray(keywords)) {
      return res.status(400).json({ error: "Keywords array is required" });
    }

    const pattern = keywords.join("\\|");
    // -C 2 brings 2 lines of context before and after the match
    const grepCmd = `grep -rInE -C 2 "${pattern}" . --exclude-dir={node_modules,dist,build,.git} | head -n 50`;

    exec(grepCmd, (error, stdout, stderr) => {
      res.json({ stdout: stdout || "" });
    });
  });

  // API Route to save project-level overview (Cache)
  app.post("/api/save-project-overview", async (req, res) => {
    const { agentType, overview, repoName } = req.body;
    if (!agentType || !overview || !repoName) {
      return res.status(400).json({ error: "AgentType, overview and repoName are required" });
    }

    try {
      const safeRepoName = repoName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const outputDir = path.join(process.cwd(), "generated_output", safeRepoName, "cache");
      
      import("fs").then((fs) => {
        fs.mkdirSync(outputDir, { recursive: true });
        const filePath = path.join(outputDir, `${agentType.toLowerCase()}_overview.md`);
        fs.writeFileSync(filePath, overview);
        res.json({ success: true, path: filePath });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to get project-level overview (Cache)
  app.get("/api/get-project-overview", (req, res) => {
    const { agentType, repoName } = req.query;
    if (!agentType || !repoName || typeof agentType !== 'string' || typeof repoName !== 'string') {
      return res.status(400).json({ error: "AgentType and repoName are required" });
    }

    try {
      const safeRepoName = repoName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const filePath = path.join(process.cwd(), "generated_output", safeRepoName, "cache", `${agentType.toLowerCase()}_overview.md`);
      
      import("fs").then((fs) => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          res.json({ overview: content });
        } else {
          res.json({ overview: null });
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to save generated code locally
  app.post("/api/save-file", async (req, res) => {
    const { fileName, content, repoName } = req.body;
    if (!fileName || !content) {
      return res.status(400).json({ error: "FileName and content are required" });
    }

    try {
      const safeRepoName = (repoName || "default").replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const outputDir = path.join(process.cwd(), "generated_output", safeRepoName, "code");
      
      // Ensure directory exists
      import("fs").then((fs) => {
        fs.mkdirSync(outputDir, { recursive: true });
        const filePath = path.join(outputDir, fileName.replace(/\//g, "_"));
        fs.writeFileSync(filePath, content);
        res.json({ success: true, path: filePath });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to save agent reports locally (Append for history)
  app.post("/api/save-report", async (req, res) => {
    const { agentType, report, repoName } = req.body;
    if (!agentType || !report) {
      return res.status(400).json({ error: "AgentType and report are required" });
    }

    try {
      const safeRepoName = (repoName || "default").replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const outputDir = path.join(process.cwd(), "generated_output", safeRepoName, "reports");
      
      import("fs").then((fs) => {
        fs.mkdirSync(outputDir, { recursive: true });
        const filePath = path.join(outputDir, `${agentType.toLowerCase()}_report.md`);
        
        const timestamp = new Date().toLocaleString();
        const separator = `\n\n--- TURN: ${timestamp} ---\n\n`;
        
        // Append instead of write
        fs.appendFileSync(filePath, separator + report);
        res.json({ success: true, path: filePath });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
