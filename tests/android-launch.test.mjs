import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/src/main/java/app/fina/casal/FinaLauncherActivity.java',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const build=readFileSync(new URL('../app/build.gradle',import.meta.url),'utf8');

test('Android usa Activity nativa que mantém tela mesmo se não houver navegador',()=>{
 assert.match(manifest,/android:name="\.FinaLauncherActivity"/);
 assert.match(source,/extends Activity/);
 assert.match(source,/setContentView\(root\)/);
 assert.match(source,/open\.setOnClickListener\(v -> openFina\(\)\)/);
 assert.match(source,/status\.setText\("Não foi possível abrir a FINA/);
 assert.doesNotMatch(source,/\bfinish\s*\(/);
});

test('Autenticação Google segue no navegador seguro, sem WebView ou TWA não verificada',()=>{
 assert.match(source,/https:\/\/fina-html-v14\.vercel\.app\//);
 assert.match(source,/new CustomTabsIntent\.Builder\(\)/);
 assert.match(source,/launchCustomTab\(true\)/);
 assert.match(source,/launchCustomTab\(false\)/);
 assert.match(source,/new Intent\(Intent\.ACTION_VIEW, FINA_URL\)/);
 assert.doesNotMatch(manifest,/androidbrowserhelper\.trusted\.LauncherActivity/);
 assert.doesNotMatch(manifest,/android\.intent\.action\.VIEW/);
 assert.doesNotMatch(source,/new\s+WebView\s*\(/);
 assert.match(build,/androidx\.browser:browser:/);
 assert.doesNotMatch(build,/androidbrowserhelper/);
});

test('Versão de correção atualiza instalador existente sem sobrescrever versão antiga',()=>{
 assert.match(build,/versionCode 2/);
 assert.match(build,/versionName "1\.0\.1"/);
 assert.match(build,/applicationIdSuffix "\.debug"/);
});
