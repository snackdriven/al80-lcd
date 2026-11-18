---
title: Tutorial — Your first custom frame
status: in-progress
type: tutorial
scope: Send your own picture to the AL80's LCD with AL80 Studio, on stock firmware, no flashing
---

# Tutorial: your first custom frame

In this tutorial, you'll put your own picture on the AL80's screen. It takes about 10 minutes. You
won't flash anything or change the keyboard's firmware, and nothing here can damage it.

By the end, you'll have:

- a picture of your choice beside the clock on the keyboard's home screen
- the same picture full-height on the keyboard's picture page
- a rough idea of what the app sent to make that happen

## What you need

- A YUNZII AL80, connected to your computer with a USB cable. Don't use Bluetooth or the 2.4G dongle for this.
- **Chrome** or **Edge** on a desktop computer. The app talks to the keyboard through WebHID, which other browsers don't support.
- Any image file, like a photo or a screenshot. A square-ish picture with one clear subject looks best on a small screen.

## 1. Free the keyboard's connection

!!! warning "Only one program can use the keyboard connection"
    The LCD connection accepts one program at a time. Close the other programs before you connect.
    If another program has the connection, AL80 Studio cannot connect.

1. Close the YUNZII web app if it is open.
2. Close VIA (usevia.app) if it is open.
3. If you run the AL80 Studio host (`host/` in the al80-studio repo), stop it.

## 2. Connect AL80 Studio

1. In Chrome or Edge, go to <https://snackdriven.github.io/al80-studio/>.
2. At the top right, select **Connect**.

    The browser opens a list of devices.

3. In the list, select your keyboard, and then select **Connect**.

    The status next to the **Connect** button stops saying **Disconnected**, and the buttons that
    need the keyboard switch on.

If your keyboard isn't in the list, go back to [step 1](#1-free-the-keyboards-connection). Something
else is probably still holding the connection.

## 3. Send a picture to the home screen

The home screen (the **main page**) shows the clock with a small picture beside it. That picture is
96×64 pixels.

1. Make sure **LCD** is selected at the top of the app. It's selected when the page opens.
2. Select the **Picture** tab.
3. Drag your image onto the box that says **Drop an image here**, or select **Choose file** and pick it.

    The **Preview** shows your image the way the keyboard will show it.

4. Leave **Fit** set to **Cover (fill, crop)** and the sliders where they are.
5. Under **Send to**, make sure **Main page** is selected.
6. Select **Send & show**.

    A progress bar fills while the picture uploads. When it's done, your picture appears beside the
    clock on the keyboard.

If the keyboard isn't showing its home screen, press **Fn + 9** to go there.

## 4. Send the same picture to the picture page

The **picture page** is a separate full-height view, 96×160 pixels. The keyboard can store up to 16
pictures there.

1. Under **Send to**, select **Picture page**.

    The preview changes to the taller shape. **Cover** crops your image to fit it.

2. Select **Send & show**.

    When the upload finishes, the keyboard switches to the picture page and shows your picture.

To go back to the clock, press **Fn + 9**, or select **Clock** in the **show:** bar near the top
of the app.

## What just happened

Each **Send & show** did more than copy a file. The app:

1. Resized your image to the page's exact size (96×64 or 96×160).
2. Converted every pixel to RGB565, a 2-byte color format the screen uses.
3. Sent the picture to the keyboard in three kinds of 64-byte messages: an **announce** (`0x40`)
   that says what's coming, the **data** (`0x41`) in small blocks, and a **finish** (`0x42`) that
   tells the keyboard to show it.
4. Waited for the keyboard to confirm each block before it sent the next one.

That waiting matters. If the blocks go out without it, the keyboard drops bytes and the picture
comes out with red and blue bands.

## Next steps

- **Try the other controls.** Change **Fit**, the sliders, **Grayscale** or **Dither**, and send
  again to compare.
- **Do it without the app.** [Render a custom 96×160 frame](../how-to/render-a-frame.md) builds the
  same messages yourself.
- **Look up the bytes.** [Still images](../protocol/still-images.md) has the exact picture format.
- **Understand the commit step.** [Display commit](../protocol/display-commit.md) explains why the
  waiting matters.
- **Remove pictures later.** In the **Picture** tab, open **Stored pictures**. It explains how
  **Next** and **Delete shown** work.
