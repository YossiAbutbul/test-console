Test Console
============

WHAT THIS IS

  A test console for the DUT. It runs entirely on this PC -- nothing is
  installed, nothing is sent anywhere.


RUNNING IT

  1. Unzip this folder anywhere you like. The Desktop is fine.
  2. Double-click TestConsole.exe.
  3. A black console window opens and your browser opens on the console.

  Windows will probably say "Windows protected your PC" the first time,
  because the app is not code-signed. Click "More info", then "Run anyway".

  Leave the black window open while you work -- that is the app itself.
  Close it to stop.


WHAT YOU NEED

  Windows 10 or later, and Bluetooth. That is all. The DUT connects over
  Bluetooth, so if this PC has no Bluetooth adapter the app will start but
  will not find anything to talk to.


WHAT IS GREYED OUT

  The pages for the lab instruments -- Trombone, Switch, Network Analyzer,
  Power Meter, Signal Generator, Mode Sweep, Load Pull -- are visible but
  disabled. They need instruments wired to the test rig, which this build
  does not include. Everything that talks to the DUT works.


UNINSTALLING

  Delete the folder. Nothing else is left behind.


IF IT DOES NOT START

  Read the black console window; the error is in there. The usual causes are
  antivirus quarantining the exe, or an unzip that did not finish -- unzip
  the whole folder, do not run the exe from inside the zip.
