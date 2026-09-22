# Introduction

The Test Console is a desk tool for testing an RF power amplifier. It drives a
**device under test (DUT)** over Bluetooth LE, measures it with bench
instruments, and records the results.

It has two parts:

- a **FastAPI backend** on port 8000, which talks to the hardware;
- a **React frontend** in the browser, where the operator works.

This manual covers the whole application:

- installation and configuration;
- every supported device and how it is connected;
- the console itself;
- each test, step by step.

![The console, LoRa › TX › CW](img/shell-overview.png)

## About the screenshots

- **Source:** every screenshot was taken from the running application, in the
  **Light** theme.
- **Example data:** screenshots captioned *example data* show synthetic
  results, which were seeded into a throw-away browser profile so that tables
  and charts have something to show. Nothing in them was measured.
- **DUT pages:** these pages are normally dimmed until a unit is connected.
  They are shown as they appear once connected. The dimmed state is shown in
  section 3.1.

## Which page do I use?

| I want to… | Page | Section |
|---|---|---|
| Key a LoRa CW carrier at one setting and read power and current | LoRa › TX › **CW** (Manual) | 4.2 |
| Sweep LoRa CW over frequency and power with pass/fail | LoRa › TX › **CW** (Automation) | 4.2 |
| Transmit LoRa or FSK modulation | LoRa › TX › **Modulated** | 4.3 |
| Set the PA duty-cycle and HP-max registers directly | LoRa › TX › **Debug** | 4.4 |
| Find the lowest-current PA setting for each power level | LoRa › TX › **Mode Sweep** | 4.5 |
| Map power and efficiency against load impedance | LoRa › Other › **Load Pull Test** | 4.6 |
| Test an LTE (Cat-M) unit | LTE › TX › **CW** / **Modulated** | 5 |
| Move the trombone, flip the RF switch, read the VNA, use the power meter or signal generator by hand | **Components** | 6 |

## Safety first

The rig is live hardware. Each of the following controls acts on the physical
world **immediately, with no confirmation**:

| Action | Controls |
|---|---|
| **Keys the PA / transmits RF** | **Send** and **Run** on every TX page; **RF On** on the Signal Generator page. The VNA transmits its stimulus for as long as it is connected. |
| **Moves the trombone** | **Move**, **Step up/down**, **Go min/max** (Trombone page); **Jog**, **Go to Zero/End** and **Run** (Load Pull) |
| **Changes the RF path** | **Go VNA / Go PCB / Move** (Switch page); **VNA / PCB** (Load Pull). Connecting the RF switch from the Instruments panel moves it to VNA. |
| **Powers the DUT** | The **DC analyzer supply** switch in Settings; the LTE **Modem** key |

These stay on until you turn them off:

- A manual **Send** on a LoRa TX page keeps the DUT transmitting until you
  press **Stop**.
- The LTE modem stays powered until you turn off the **Modem** key.
- Disconnecting the signal generator does **not** switch its RF output off.

The Load Pull page has an **Emergency stop** button (round, red) that is
always enabled. The Trombone page has **Stop** in its header.

## Conventions

- **Bold** text is a label exactly as it appears in the application, for
  example **Run sweep**.
- `Monospace` text is something you type, a file name, or a value on the wire.
- "Path loss" always means the dB figure *added* to the sensor reading to get
  the power at the DUT: **DUT power = sensor reading + path loss**.
- Page names follow the sidebar: *Protocol › Group › Page*.
