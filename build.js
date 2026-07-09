const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const browserArg = args.find(arg => arg.startsWith("--browser="));
const browser = browserArg ? browserArg.split("=")[1] : "chrome";

console.log(`Building for ${browser}${watch ? " (watch mode)" : ""}...`);

const outdir = `dist/${browser}`;

const buildOptions = {
	entryPoints: [
		{ in: "src/content/main.ts", out: "content/main" },
		{ in: "src/content/scraper.ts", out: "content/scraper" },
		{ in: "src/background/background.ts", out: "background/background" },
	],
	bundle: true,
	minify: !watch,
	sourcemap: watch ? "inline" : false,
	outdir: outdir,
	platform: "browser",
	target: ["es2020"],
	loader: {
		".ts": "ts",
	},
	define: {
		"process.env.NODE_ENV": watch ? '"development"' : '"production"',
	},
};

async function run() {
	if (watch) {
		let ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log("Watching for changes...");
	} else {
		await esbuild.build(buildOptions);
		console.log("Build complete.");
	}

	// Copy and modify assets
	copyAndModifyAssets();
}

function copyAndModifyAssets() {
	// 1. Process manifest.json
	const manifestPath = path.join(__dirname, "manifest.json");
	if (fs.existsSync(manifestPath)) {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

		if (browser === "chrome") {
			// Chrome specific: use service_worker
			manifest.background = {
				service_worker: "background/background.js"
			};
			// Chrome doesn't want browser_specific_settings for local/store builds
			delete manifest.browser_specific_settings;
		} else if (browser === "firefox") {
			// Firefox specific: use scripts for better compatibility in MV3
			manifest.background = {
				scripts: ["background/background.js"],
				type: "module"
			};
			// Ensure gecko settings exist (id is sourced from manifest.json)
			if (!manifest.browser_specific_settings) {
				manifest.browser_specific_settings = {};
			}

			// Set data_collection_permissions
			manifest.browser_specific_settings.gecko.data_collection_permissions = {
				required: ["none"],
				optional: []
			};
		}

		const destManifestPath = path.join(__dirname, outdir, "manifest.json");
		const destDir = path.dirname(destManifestPath);
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}
		fs.writeFileSync(destManifestPath, JSON.stringify(manifest, null, 2));
		console.log(`Manifest optimized for ${browser} and copied.`);
	}

	// 2. Copy other assets
	const assets = [
		{ src: "styles/injected.css", dest: `${outdir}/styles/injected.css` },
	];

	if (fs.existsSync("icons")) {
		assets.push({ src: "icons", dest: `${outdir}/icons` });
	}

	assets.forEach((asset) => {
		if (!fs.existsSync(asset.src)) {
			console.warn(`Warning: Asset source ${asset.src} not found, skipping.`);
			return;
		}

		const destDir = path.dirname(asset.dest);
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}

		if (fs.lstatSync(asset.src).isDirectory()) {
			if (!fs.existsSync(asset.dest)) {
				fs.mkdirSync(asset.dest, { recursive: true });
			}
			fs.readdirSync(asset.src).forEach((file) => {
				fs.copyFileSync(
					path.join(asset.src, file),
					path.join(asset.dest, file),
				);
			});
		} else {
			fs.copyFileSync(asset.src, asset.dest);
		}
	});
	console.log("Other assets copied.");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
