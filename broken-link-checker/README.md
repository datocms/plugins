# Broken Link Checker

Finds broken links in your DatoCMS content. You can scan the whole project and see where each bad link is used, or check a single record from its sidebar. The plugin only reads your content and never changes it.

![The Link checker page listing links that need attention](docs/project-report.png)

## Installation

Install **Broken Link Checker** from **Configuration → Plugins** and, when asked, let it use the current user's API token. The project scan needs it to read your records. Without it, the record sidebar check still works but the Link checker page is hidden. There's nothing else to configure.

## Scanning the project

Open **Content → Link checker** and click **Scan links**. To limit the scan to some models or locales, use **Choose what to scan…** first.

Each link gets one row, listing every record, field and locale that uses it. Select a link to see the server's response and open the records from there to fix it, then click **Recheck URL**. **Export CSV** downloads the whole report. Results disappear when you leave the page, so export them if you want to keep a copy, and keep the page open until the scan finishes.

The scan reads the latest saved version of every record in the current environment, drafts and invalid records included, but only records your role can read. Anything it couldn't read is listed in the report.

## Checking a single record

Open a record, expand **Broken links** in the sidebar and click **Check links**. Every locale is checked, unsaved changes included. Click a result to jump to the field that holds the link.

![A record with its Broken links sidebar panel](docs/record-panel.png)

## Reading the results

Each result comes with a short explanation. **Unverified** means the check couldn't confirm the link either way (a server error, a bad certificate, no response). **Blocked** means the website turned away the automated request with bot protection, rate limiting or a sign-in page. Links are checked through DatoCMS's link-checking service, and many sites guard against that kind of traffic, so a blocked link is usually fine. Open it yourself to be sure.

Some problems aren't caught. Only the part before `#` is requested, so missing anchors aren't detected. A login screen or a "not found" message served as a normal page counts as reachable. `mailto:` links, relative paths, `localhost` and private IP addresses are skipped.

The scan covers single-line text fields holding a URL, multi-paragraph text (plain, Markdown or HTML), Structured Text links, and everything inside Modular Content, Single Block and Structured Text blocks. It doesn't check assets.

## Development

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Test coverage and the manual validation checklist are in [docs/VALIDATION.md](docs/VALIDATION.md).
