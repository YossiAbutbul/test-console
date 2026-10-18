# Before you start

This guide is for the person at the bench. It explains how to run each test
on the Test Console, how to read the results and how to save them. It leaves
out installation and anything technical; for those, see the full Operator
Manual.

![The Test Console](img/shell-overview.png)

## What the console does

The console tests the power amplifier in a meter, called the **DUT** (device
under test). It talks to the DUT over Bluetooth, tells it to transmit, and
measures what comes out with the bench instruments:

- the **power sensor** measures the RF power;
- the **DC analyzer** powers the DUT and measures the current it draws;
- for Load Pull, the **network analyzer**, the **RF switch** and the
  **trombone** change and measure the load the DUT drives.

## Safety first

The rig is live. These controls act **at once, with no "are you sure?"**:

| What happens | Which controls do it |
|---|---|
| **The DUT transmits** | **Send** and **Run** on every test page; **RF On** on the Signal Generator page |
| **The trombone moves** | **Move**, **Step**, **Go min/max** on the Trombone page; **Jog**, **Go to Zero/End** and **Run** on Load Pull |
| **The RF path changes** | **Go VNA / Go PCB** on the Switch page; **VNA / PCB** on Load Pull |
| **The DUT is powered** | **Output On** on the DC Analyzer page, the supply switch in **Settings**, the LTE **Modem** key |

Some things **stay on until you turn them off**:

- A manual **Send** on a LoRa page keeps the DUT transmitting until you press
  **Stop**.
- The LTE modem stays powered until you turn off the **Modem** key.
- Disconnecting the signal generator does **not** switch its RF output off.

> **Watch the top bar.** While anything is live, a coloured tag appears at
> the top right of the screen on every page: **RF ON**, **DC ON**, **LTE TX**
> (with the time left) or **Run**. Click a tag to jump to the page that
> controls it. If a tag is showing and you didn't expect it, go and turn that
> output off.

The Load Pull page has a round red **Emergency stop**, always available. It
stops the motor first, then the run, then the transmitter.

## Which test do I use?

| I want to… | Go to | Chapter |
|---|---|---|
| Transmit a LoRa carrier at one setting and read power and current | LoRa › TX › **CW**, Manual tab | 3 |
| Check LoRa power over several frequencies and powers, with pass/fail | LoRa › TX › **CW**, Automation tab | 3 |
| Test LoRa or FSK modulation | LoRa › TX › **Modulated** | 3 |
| Set the PA duty cycle and HP max by hand | LoRa › TX › **Debug** | 3 |
| Find the lowest-current setting for every power level | LoRa › TX › **Mode Sweep** | 3 |
| See how power and efficiency change with the load | LoRa › Other › **Load Pull Test** | 3 |
| Test an LTE (Cat-M) unit | LTE › TX › **CW** or **Modulated** | 4 |
| Measure the loss of a cable or attenuator | **Signal Generator** + **Power Meter** | 6 |

## How to read this guide

- **Bold** words are buttons and labels exactly as they appear on screen.
- Page names follow the menu on the left: *LoRa › TX › CW*.
- **Path loss** is the loss between the DUT and the power sensor. The console
  adds it to every reading, so the numbers you see are the power **at the
  DUT**.
