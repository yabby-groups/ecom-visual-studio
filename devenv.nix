{ pkgs, ... }:

{
  packages = [ pkgs.nodejs ];

  languages.python = {
    enable = true;
    # version = "3.12";
    venv.enable = true;
    venv.requirements = ./requirements.txt;
  };

  tasks = {
    "ecom:install-frontend" = {
      exec = "npm ci";
      before = [ "devenv:enterShell" ];
    };
  };

  processes = {
    backend.exec = "uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000";
    frontend.exec = "npm run dev -- --host 127.0.0.1";
  };

  scripts.test.exec = ''
    pytest -q
    npm test
  '';

  enterShell = ''
    echo "Run 'devenv up' to start the API and web client."
    echo "Run 'devenv shell test' to run the test suite."
  '';
}
