# Better Coretax

**Better Coretax** is a powerful browser extension designed to enhance and optimize the DJP Coretax portal. It simplifies the process of parsing, retrieving, and exporting massive volumes of tax data into clean, formatted Excel files and bulk PDF downloads.

## Key Features

- **High-Speed e-Faktur Export (Output Tax):** Automatically scrapes hundreds or thousands of output tax invoice rows in seconds (up to 500 rows per request) without network timeouts.
- **SPT Masa PPN Annex A2 & B2 Export:** Bypasses portal limitations to pull massive amounts of data for Annex A2 (Output Tax) and B2 (Input Tax) directly into Excel (1,000 rows per request).
- **Bulk Withholding Slip PDF Downloader:** Automatically downloads withholding slip PDFs sequentially with intelligent naming conventions (MM-YYYY-Number-Name.pdf).
- **Smart Paginator Bypass:** Eliminates the need for manual "Next Page" clicks by automatically traversing server-side paginated data (Lazy Loading).
- **Integrated Search Filters:** Adds custom "Reference" search filters directly into the Coretax toolbar and grid headers for faster data location.
- **Auto-Formatting Excel:** Automatically converts system date formats (ISO Strings) into standard Indonesian date formats (`DD/MM/YYYY`) in the generated `.xlsx` sets.
- **Lean UI Integration:** Features a fully integrated in-page UI (floating info bar and custom toolbar buttons) designed to feel like part of the native Coretax experience.

## Prerequisites

- **Node.js** (v18 or later)
- **npm** (v9 or later)

## Installation & Build

### 1. Setup
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Build for Production
Generate the production-ready extension for your preferred browser:

| Command | Output Directory | Result |
|---------|------------------|--------|
| `npm run build:chrome` | `dist/chrome/` | Unpacked Chrome extension |
| `npm run build:firefox`| `dist/firefox/`| Unpacked Firefox extension |
| `npm run package`      | `/` (root)     | `.zip` (Chrome) & `.xpi` (Firefox) |

### 3. Loading the Extension

#### Google Chrome / Edge
1. Navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `dist/chrome/` folder.

#### Mozilla Firefox
1. Navigate to `about:addons`.
2. Click the gear icon (⚙️) and select **Install Add-on From File...**.
3. Select the `better-coretax-firefox.xpi` file generated in the root directory.
   *(Note: For local testing, ensure `xpinstall.signatures.required` is set to `false` in `about:config`)*.

## Tech Stack
- **Language:** TypeScript
- **Bundler:** esbuild
- **Persistence:** Chrome Storage API
- **Excel Generation:** SheetJS (xlsx)
- **UI:** Vanilla DOM & CSS

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Information for Mozilla Reviewers
This extension is built using TypeScript and bundled using `esbuild`. The original logic is fully documented in the provided source ZIP. To reproduce the build, use `npm install` followed by `npm run build:firefox`.
