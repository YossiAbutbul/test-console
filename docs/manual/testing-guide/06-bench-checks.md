# 6. Bench checks

## 6.1 Measuring path loss

Do this for every frequency you test at, and again whenever you change a
cable or attenuator.

![Bench for a path-loss check](img/diagram-4.png)

1. Connect the **signal generator** to the input of the cable or attenuator,
   and the **power sensor** to its output.
2. On *Components › Signal Generator*, set the frequency and a known level,
   and press **RF On**.
3. On *Components › Power Meter*, read the power at the same frequency.
4. **Path loss = level set − level read.** Enter it in the path loss table
   (1.5) at that frequency.
5. Press **RF Off** on the Signal Generator page. Disconnecting the
   generator does **not** turn its output off.

![Signal Generator](img/signal-generator.png)

![Power Meter](img/power-meter.png)

## 6.2 Checking the trombone before Load Pull

1. Put the switch on VNA: press **Go VNA** on *Components › Switch*.
2. On *Components › Network Analyzer*, watch the Smith chart.
3. On *Components › Trombone*, step the trombone and check the load moves
   smoothly around the chart.

## 6.3 Watching the DUT's current

*Components › DC Analyzer* shows the DUT's voltage, current and power live,
and lets you set the voltage and a current limit. **Output On** powers the
DUT.

![DC Analyzer](img/dc-analyzer.png)
