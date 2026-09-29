import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(harnessDirectory, '..', '..', '..');
const sourceDirectory = path.join(projectRoot, 'src');
const port = Number(process.env.CRS_TEST_PORT || 4173);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function expandAppsScriptIncludes(markup) {
  const includeExpression = /<\?!=\s*include_\(\s*['"]([a-z0-9-]+)['"]\s*\)\s*;?\s*\?>/gi;
  let expanded = markup;
  let pass = 0;
  while (includeExpression.test(expanded)) {
    includeExpression.lastIndex = 0;
    expanded = expanded.replace(includeExpression, (expression, partialName) => {
      const partialPath = path.join(sourceDirectory, `${partialName}.html`);
      if (!fs.existsSync(partialPath)) {
        throw new Error(`Missing Apps Script HTML partial: ${partialName}`);
      }
      return readUtf8(partialPath);
    });
    pass += 1;
    if (pass > 10) throw new Error('Apps Script include expansion exceeded ten passes');
  }
  return expanded;
}

function removeExternalStyles(markup) {
  return markup
    .replace(/\s*<link\b[^>]*\brel=["']preconnect["'][^>]*>/gi, '')
    .replace(/\s*<link\b[^>]*\bhref=["']https:\/\/fonts\.googleapis\.com\/[^"']*["'][^>]*>/gi, '')
    .replace(/\s*<link\b[^>]*\bhref=["']https:\/\/cdn\.jsdelivr\.net\/[^"']+\.css[^"']*["'][^>]*>/gi, '');
}

function replaceBootstrapScript(markup, bootstrapScript) {
  const externalBootstrap = /<script\b[^>]*\bsrc=["']https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@[^"']+["'][^>]*>\s*<\/script>/i;
  if (!externalBootstrap.test(markup)) {
    throw new Error('Could not find the Bootstrap script in src/index.html');
  }
  return markup.replace(externalBootstrap, `<script>\n${bootstrapScript}\n</script>`);
}

function assembleApplication(requestUrl) {
  const initialView = requestUrl.searchParams.get('view') || 'dashboard';
  const initialAssetId = requestUrl.searchParams.get('id') || requestUrl.searchParams.get('asset_id') || '';
  const bootstrapCss = readUtf8(path.join(harnessDirectory, 'bootstrap-lite.css'));
  const bootstrapScript = readUtf8(path.join(harnessDirectory, 'bootstrap-lite.js'));
  const browserEnvironment = readUtf8(path.join(harnessDirectory, 'browser-environment.js'));

  let markup = readUtf8(path.join(sourceDirectory, 'index.html'));
  markup = markup
    .replace(/<\?=\s*initialView\s*\?>/g, escapeAttribute(initialView))
    .replace(/<\?=\s*initialAssetId\s*\?>/g, escapeAttribute(initialAssetId));
  markup = removeExternalStyles(markup);
  markup = markup.replace("<?!= include_('styles'); ?>",
    `<style data-test-bootstrap-lite>\n${bootstrapCss}\n</style>\n<?!= include_('styles'); ?>`);
  markup = markup.replace('</head>', [
    `<script data-test-browser-environment>\n${browserEnvironment}\n</script>`,
    '</head>'
  ].join('\n'));
  markup = expandAppsScriptIncludes(markup);
  markup = replaceBootstrapScript(markup, bootstrapScript);

  if (/<\?[!=]?/.test(markup)) {
    throw new Error('Unexpanded Apps Script template expression remains in the assembled page');
  }
  return markup;
}

function respond(response, status, contentType, body) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/health') {
    respond(response, 200, 'text/plain; charset=utf-8', 'ok');
    return;
  }
  if (requestUrl.pathname === '/favicon.ico') {
    respond(response, 204, 'image/x-icon', '');
    return;
  }
  if (requestUrl.pathname !== '/' && requestUrl.pathname !== '/index.html') {
    respond(response, 404, 'text/plain; charset=utf-8', 'not found');
    return;
  }
  try {
    respond(response, 200, 'text/html; charset=utf-8', assembleApplication(requestUrl));
  } catch (error) {
    respond(response, 500, 'text/plain; charset=utf-8', error && error.stack ? error.stack : String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`CRS frontend harness listening on http://127.0.0.1:${port}\n`);
});

function close() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
