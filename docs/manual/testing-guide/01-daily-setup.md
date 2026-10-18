# 1. Daily setup

Do these steps once at the start of a session. After that, every test page is
ready to use.

## 1.1 Cable the bench

For all the transmit tests (LoRa and LTE CW, Modulated, Debug, Mode Sweep),
cable the bench like this:

![Cabling for the transmit tests](img/diagram-1.png)

- The DUT's RF output goes through a **fixed attenuator** and cables to the
  **power sensor**.
- The **DC analyzer** powers the DUT and measures its current.
- The PC talks to the DUT over Bluetooth and to the instruments over USB.

> **Protect the sensor.** Make sure the attenuator can handle the DUT's full
> power, and that the power reaching the sensor stays below its damage level.

Load Pull needs a different bench; it is described with the test in
chapter 3.

## 1.2 Connect the instruments

1. Click **Instruments** at the top of the left-hand menu.
2. The panel finds the instruments by itself and fills in their addresses.
   Wait a few seconds for it to finish.
3. Press **Connect all**, or **Connect** on each instrument you need. A green
   dot means connected.

![The Instruments panel](img/instruments-modal.png)

You don't have to do this in advance: when you press **Send** or **Run**, the
console connects whatever the test needs on its own (see 1.6).

**If an instrument won't connect,** its row says why and what to do:

| Message | What to do |
|---|---|
| No response | Check the instrument is on and its cable is plugged in, then try again. |
| Not found at that address | Press the re-scan arrow on that row and pick it again. |
| Already in use | Another program has it open. Close that program and try again. |

## 1.3 Power the DUT

1. Make sure the DC analyzer is connected.
2. Open **Settings** (the gear at the bottom of the left-hand menu).
3. Check the voltage (3.6 V by default) and turn the **DC analyzer supply**
   switch on.

![Settings](img/settings.png)

For a current limit or to watch the current continuously, use the
**DC Analyzer** page under **Components** instead.

## 1.4 Connect the DUT

The row along the top of every page is for the DUT.

1. Choose the **Device type** (for example *Sonata 2 IL*).
2. Press **Scan**. Units appear as they are found, strongest first.
3. Pick your unit from the list. You can type part of its MAC address, its
   name or its nickname to find it.
4. Press **Connect**. The bottom of the left-hand menu turns green and shows
   the unit's name.

> **Connect only works for a unit found in the current scan.** If you reload
> the page, press **Scan** again first.

Tips:

- The pencil next to the MAC field gives a unit a **nickname** such as "Lab
  unit 3". Nicknamed units show a coloured tag and sort to the top.
- The test pages are **faded out** until a DUT is connected. That is normal.

![A test page before a DUT is connected](img/dut-page-dimmed.png)

## 1.5 Enter the path loss

The **Path loss (dB)** box at the top left is the default loss between the
DUT and the sensor. The tune icon inside it opens a **table of losses per
frequency**.

![The path loss table](img/path-loss-table.png)

- Enter a line for **every frequency you test at**. The console uses a table
  entry only at exactly that frequency; it does not guess between them.
- Any other frequency uses the default and is marked **uncalibrated** in
  amber. Treat its readings with care.
- To measure a loss, see chapter 6.

## 1.6 What happens when you press Send or Run

Before transmitting, the console checks that the test's instruments are
connected. If one is missing, a **Connecting instruments** box connects it
for you. If it still fails, you can choose:

| Button | Result |
|---|---|
| **Open Instruments** | Stops and opens the Instruments panel so you can fix it |
| **Cancel** | Stops; nothing is transmitted |
| **Send anyway** / **Run anyway** | Carries on without that instrument; its readings stay blank |
