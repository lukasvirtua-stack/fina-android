import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/src/main/java/app/fina/casal/FinaLauncherActivity.java',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const strings=readFileSync(new URL('../app/src/main/res/values/strings.xml',import.meta.url),'utf8');
const build=readFileSync(new URL('../app/build.gradle',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/build-apk.yml',import.meta.url),'utf8');
const assetScript=readFileSync(new URL('../scripts/update-assetlinks.mjs',import.meta.url),'utf8');

test('FINA inicia em tela nativa com fallback recuperável e Google no Chrome',()=>{
 assert.match(manifest,/android:name="\.FinaLauncherActivity"/);
 assert.match(source,/extends Activity/);
 assert.match(source,/setContentView\(root\)/);
 assert.match(source,/open\.setOnClickListener\(v -> openFina\(\)\)/);
 assert.match(source,/status\.setText\("Não foi possível abrir a FINA/);
 assert.match(source,/launchFallbackBrowser\(\)/);
 assert.match(source,/new Intent\(Intent\.ACTION_VIEW, FINA_URL\)/);
 assert.doesNotMatch(source,/\bfinish\s*\(/);
 assert.doesNotMatch(source,/new\s+WebView\s*\(/);
});

test('Tela sem barra só via TWA com Digital Asset Links, nunca forçando verificação',()=>{
 assert.match(source,/new TwaLauncher\(this,\s*"com\.android\.chrome"\)/);
 assert.match(source,/new TrustedWebActivityIntentBuilder\(FINA_URL\)/);
 assert.match(source,/twaLauncher\.launch\(builder,\s*new CustomTabsCallback\(\)/);
 assert.match(source,/twaLauncher\.destroy\(\)/);
 assert.match(manifest,/android:name="asset_statements"/);
 assert.match(manifest,/android:resource="@string\/asset_statements"/);
 assert.match(manifest,/android:autoVerify="true"/);
 assert.match(manifest,/android:host="fina-html-v14\.vercel\.app"/);
 assert.match(strings,/delegate_permission\/common\.handle_all_urls/);
 assert.match(strings,/https:\/\/fina-html-v14\.vercel\.app/);
 assert.match(assetScript,/web.*\.well-known.*assetlinks\.json/);
 assert.match(assetScript,/sha256_cert_fingerprints/);
 assert.match(build,/androidbrowserhelper:androidbrowserhelper:2\.7\.4/);
});

test('Assinatura da TWA é associada automaticamente ao APK exato sem exportar chave privada',()=>{
 assert.match(workflow,/apksigner/);
 assert.match(workflow,/publish-assetlinks/);
 assert.match(workflow,/contents:\s*write/);
 assert.match(workflow,/scripts\/update-assetlinks\.mjs/);
 assert.doesNotMatch(assetScript,/(^|\n).*BEGIN PRIVATE KEY/);
 assert.match(assetScript,/app\.fina\.casal\.debug/);
});

test('Versão 1.0.2 e package debug permanecem compatíveis',()=>{
 assert.match(build,/versionCode 3/);
 assert.match(build,/versionName "1\.0\.2"/);
 assert.match(build,/applicationIdSuffix "\.debug"/);
});
