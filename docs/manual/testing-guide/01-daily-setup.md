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

1. In the panel on the right, on the **Bench** tab, press **Manage** next
   to **Instruments**. (If the panel is hidden, click the panel button at the
   top right of the window.)
2. The **Instruments** window finds the instruments by itself and fills in
   their addresses. Wait a few seconds for it to finish.
3. Press **Connect all** at the bottom, or **Connect** on each instrument you
   need. A green dot means connected; the Bench tab shows the same dots.

![The Instruments panel](img/instruments-modal.png)

You don't have to do this in advance: when you press **Send** or **Run**, the
console connects whatever the test needs on its own (see 1.6).

**If an instrument won't connect,** its row says why and what to do:

| Message | What to do |
|---|---|
| No response | Check the instrument is on and its cable is plugged in, then try again. |
| Not found at that address | Press the re-scan arrow (↻) at the end of that row's address box and pick it again. |
| Already in use | Another program has it open. Close that program and try again. |

## 1.3 Power the DUT

1. Make sure the DC analyzer is connected.
2. At the bottom of the left-hand menu, under **DC supply**, check the
   voltage (3.6 V by default).
3. Press the **Off** key beside it. It changes to **On**.

**Settings** (the gear next to *Test Console* at the top of the left-hand
menu) holds the DUT scan time, the **Select text on focus** switch (off: a
click in a box places the cursor; on: it selects the whole value) and the
theme.

![Settings](img/settings.png)

For a current limit or to watch the current continuously, use the
**DC Analyzer** page under **Components** instead.

## 1.4 Connect the DUT

The **Device under test** group, at the top of the **Bench** tab in the
panel on the right, is for the DUT. It is the same on every page.

1. Choose the **Device type** (for example *Sonata 2 IL*).
2. Press **Scan**. Units appear as they are found, strongest first.
3. Pick your unit from the list. You can type part of its MAC address, its
   name or its nickname to find it.
4. Press **Connect**. The group shows the unit's name, a green dot and
   **Connected**.

> **Connect only works for a unit found in the current scan.** If you reload
> the page, press **Scan** again first.

Tips:

- The pencil next to the MAC field gives a unit a **nickname** such as "Lab
  unit 3". Nicknamed units show a coloured tag and sort to the top.
- The test pages are **faded out** until a DUT is connected. That is normal.

![A test page before a DUT is connected](img/dut-page-dimmed.png)

## 1.5 Enter the path loss

On the **Bench** tab, the **Default** box under **Path loss, DUT to sensor**
is the default loss between the DUT and the sensor. The button at the right
end of the box opens a **table of losses per frequency**. The frequencies in
the table are listed under the box with their loss.

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
