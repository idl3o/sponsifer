# Watermark survival: the real test

`scripts/survival.py` tells you how the watermark survives transforms we can simulate. It cannot tell you what Meta, TikTok or YouTube actually do to a file this month. This protocol can, and it is the go or no-go for relying on a seal.

It takes about an hour, needs no special access, and is worth repeating when a platform changes its pipeline.

## What you need

- `pipx install 'sponsifer[seal]'` and `sponsifer setup`.
- Two or three finished images of the kind you actually deliver, in the aspect ratios you deliver them.
- An account on each platform you want to test. A test ad needs a small spend, and a few pounds will do.

## Protocol

1. **Make a test deal.** In the app, served by `sponsifer`, add a prospect called `Survival test` and record a won deal against it with usage set to whitelisting.
2. **Seal each image.** `sponsifer seal <deal> image.png --source capture`. Seal each aspect ratio separately, because reframing is the one transform the proxy shows the mark does not survive.
3. **Push each sealed file through each real route:**
   - an organic post on each platform;
   - a paid ad on Meta (feed and story placements) and on TikTok, using the sealed file as the creative;
   - a YouTube thumbnail, and a Short that opens on the image.
4. **Get the file back the way a creator would find it.** Download the ad creative from the Meta Ad Library or TikTok's Commercial Content Library, screenshot the post at full resolution on a phone, and save the thumbnail from the page.
5. **Decode each one.** `sponsifer verify downloaded.jpg --started <today>`. The claim itself will fail the ordering check, because the ad started after the seal but on the same day. That is expected. What you are recording is whether the serial decoded.

## Record the result

| Route | Aspect | Serial decoded? | Notes |
|---|---|---|---|
| Meta feed ad, Ad Library download | 1:1 | | |
| Meta story ad, Ad Library download | 9:16 | | |
| TikTok ad, Commercial Content Library | 9:16 | | |
| Instagram organic post, phone screenshot | 4:5 | | |
| YouTube thumbnail | 16:9 | | |

If you are willing, open an issue with the table. It needs no brand, no handle and no rates, and it tells every other creator whether sealing is worth their time on that platform.
