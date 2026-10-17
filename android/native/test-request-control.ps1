$ErrorActionPreference = 'Stop'
$classes = Join-Path $PSScriptRoot 'request-test-classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') --release 8 -encoding UTF-8 -d $classes (Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\RequestControl.java') (Join-Path $PSScriptRoot 'test\RequestControlTest.java')
if ($LASTEXITCODE -ne 0) { throw 'RequestControl test compilation failed' }
& (Join-Path $env:JAVA_HOME 'bin\java.exe') -classpath $classes local.mixtunes.mobile.RequestControlTest
if ($LASTEXITCODE -ne 0) { throw 'RequestControl test failed' }
