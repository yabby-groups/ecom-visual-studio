{ pkgs, ... }:

{
  packages = [
    pkgs.nodejs
    pkgs.go
    pkgs.nsis
    pkgs.pkgsCross.mingwW64.stdenv.cc
    pkgs.pkgsCross.mingw32.stdenv.cc
  ];

  tasks = {
    "ecom:install-frontend" = {
      exec = "npm ci";
      before = [ "devenv:enterShell" ];
    };
  };

  processes = {
    frontend.exec = "npm run dev -- --host 127.0.0.1";
  };

  scripts.test.exec = ''
    go test ./...
    go vet ./...
    npm test
  '';

  enterShell = ''
    echo "Run 'npm run desktop:dev' for the supported Go/Wails application."
    echo "Run 'devenv up' for the frontend-only Vite process."
    echo "Run 'devenv shell test' to run the test suite."
  '';
}
