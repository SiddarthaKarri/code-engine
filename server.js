const express = require("express");
const bodyParser = require("body-parser");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();

app.use(bodyParser.json({ limit: "10mb" }));

// Prevent hanging sockets
app.use((req, res, next) => {
    req.setTimeout(30000);
    res.setTimeout(30000);
    next();
});

const EXEC_DIR = "/tmp/executions";

if (!fs.existsSync(EXEC_DIR)) {
    fs.mkdirSync(EXEC_DIR, { recursive: true });
}

function log(...args) {
    console.log(new Date().toISOString(), "-", ...args);
}

// ---------------- PROCESS RUNNER ----------------

function runCommand(command, args, cwd, timeoutMs, inputStr = "") {
    return new Promise((resolve) => {
        const start = Date.now();

        let stdout = "";
        let stderr = "";

        const child = spawn(command, args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"]
        });

        let killedByTimeout = false;

        const timer = setTimeout(() => {
            killedByTimeout = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on("data", (data) => {
            stdout += data.toString();

            // Prevent memory explosion
            if (stdout.length > 5 * 1024 * 1024) {
                child.kill("SIGKILL");
            }
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();

            if (stderr.length > 5 * 1024 * 1024) {
                child.kill("SIGKILL");
            }
        });

        child.on("error", (err) => {
            clearTimeout(timer);

            resolve({
                stdout: "",
                stderr: err.message,
                code: 1,
                timeMs: Date.now() - start
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);

            const timeMs = Date.now() - start;

            if (killedByTimeout) {
                return resolve({
                    stdout: "",
                    stderr: "Time limit exceeded",
                    code: 124,
                    timeMs
                });
            }

            resolve({
                stdout,
                stderr,
                code: code ?? 0,
                timeMs
            });
        });

        try {
            if (inputStr) {
                child.stdin.write(inputStr);
            }

            child.stdin.end();
        } catch (e) {
            // ignore stdin issues
        }
    });
}

// ---------------- EXECUTION HANDLER ----------------

async function handleBatchExecution(
    language,
    jobDir,
    files,
    inputs,
    compileTimeout,
    runTimeout
) {
    // Write files
    for (const f of files) {
        let name = f.name;

        if (!name) {
            if (language === "cpp") name = "main.cpp";
            else if (language === "python") name = "main.py";
            else if (language === "java") name = "Main.java";
            else if (language === "javascript") name = "main.js";
        }

        fs.writeFileSync(
            path.join(jobDir, name),
            f.content || "",
            "utf8"
        );
    }

    let compileRes = {
        code: 0,
        stdout: "",
        stderr: ""
    };

    let runCommandInfo = null;

    // ---------------- COMPILE ----------------

    if (language === "cpp") {
        compileRes = await runCommand(
            "g++",
            ["-std=c++17", "-O2", "main.cpp", "-o", "main"],
            jobDir,
            compileTimeout
        );

        runCommandInfo = {
            command: "./main",
            args: []
        };
    }

    else if (language === "java") {
        compileRes = await runCommand(
            "javac",
            ["Main.java"],
            jobDir,
            compileTimeout
        );

        runCommandInfo = {
            command: "java",
            args: ["Main"]
        };
    }

    else if (language === "python") {
        runCommandInfo = {
            command: "python3",
            args: ["main.py"]
        };
    }

    else if (language === "javascript") {
        runCommandInfo = {
            command: "node",
            args: ["main.js"]
        };
    }

    if (compileRes.code !== 0) {
        return {
            compile: compileRes,
            results: []
        };
    }

    // ---------------- RUN ----------------

    const results = [];

    for (const input of inputs) {
        const runRes = await runCommand(
            runCommandInfo.command,
            runCommandInfo.args,
            jobDir,
            runTimeout,
            input
        );

        results.push(runRes);
    }

    return {
        compile: compileRes,
        results
    };
}

// ---------------- ROUTES ----------------

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        server: "optimized-judge",
        languages: ["cpp", "python", "java", "javascript"]
    });
});

app.post("/api/v2/piston/execute", async (req, res) => {
    const body = req.body || {};

    let {
        language,
        files,
        stdin,
        inputs,
        compile_timeout,
        run_timeout
    } = body;

    language = (language || "").toLowerCase();

    files = files || [];

    const batchInputs =
        Array.isArray(inputs) && inputs.length > 0
            ? inputs
            : [stdin || ""];

    compile_timeout = Number(compile_timeout) || 10000;
    run_timeout = Number(run_timeout) || 3000;

    const jobId = uuidv4();

    const jobDir = path.join(EXEC_DIR, jobId);

    fs.mkdirSync(jobDir, { recursive: true });

    log(
        "[JOB START]",
        jobId,
        "lang=",
        language,
        "batch_size=",
        batchInputs.length
    );

    try {
        if (
            ![
                "cpp",
                "c++",
                "python",
                "java",
                "javascript",
                "node",
                "js"
            ].includes(language)
        ) {
            return res.status(400).json({
                error: `Unsupported language: ${language}`
            });
        }

        if (language === "c++") language = "cpp";
        if (language === "node" || language === "js") {
            language = "javascript";
        }

        const result = await handleBatchExecution(
            language,
            jobDir,
            files,
            batchInputs,
            compile_timeout,
            run_timeout
        );

        const legacyRun =
            result.results.length > 0
                ? result.results[0]
                : {
                      code: 0,
                      stdout: "",
                      stderr: ""
                  };

        log("[JOB DONE]", jobId);

        return res.json({
            language,
            compile: result.compile,
            run: legacyRun,
            results: result.results
        });
    } catch (err) {
        log("[JOB ERROR]", jobId, err);

        return res.status(500).json({
            error: err.message || String(err)
        });
    } finally {
        try {
            fs.rmSync(jobDir, {
                recursive: true,
                force: true
            });
        } catch (_) {}
    }
});

// ---------------- GLOBAL ERROR HANDLERS ----------------

process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("UNHANDLED REJECTION:", err);
});

// ---------------- START SERVER ----------------

const PORT = process.env.PORT || 8000;

app.listen(PORT, "0.0.0.0", () => {
    log(`Judge server listening on port ${PORT}`);
});