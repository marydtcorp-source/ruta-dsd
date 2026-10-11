// Parches de los plugins para compilar con JDK 25 + Gradle 9 (sin JDK 21 instalado):
//  - jcenter() ya no existe en Gradle 9
//  - jvmToolchain(21) exige un JDK 21 instalado: se cambia por jvmTarget 21 con el JDK en uso
const fs = require('fs'), path = require('path');
const files = [
  '@pantrist/capacitor-plugin-ml-kit-text-recognition', '@capacitor/filesystem', '@capacitor/share', '@capgo/capacitor-document-scanner',
].map((p) => path.join(__dirname, 'node_modules', p, 'android', 'build.gradle'));
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(/jcenter\(\)/g, 'mavenCentral()')
    .replace(/jvmToolchain\(21\)/g, 'compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21 }');
  fs.writeFileSync(f, s);
}
console.log('plugins parcheados');
