# Checkpoint video script

Due **Thu 11/05, 11:59 PM** on Gradescope: one mp4 per team, 2:00 at most, with voiceover. Aim for about 1:45.

The course page (dsc106.com, Project 3) asks the video to cover five things, marked (1) to (5) below:
(1) team name and members, (2) the dataset and the aspects of it you plan to use, (3) 5-6 exploratory graphs that
led to your question, (4) the title of your graph or the question you are answering, (5) current progress on the
final interactive graph.

**Before recording:** run the notebook so the demo banner is gone, fill in `js/team.js`, open `checkpoint.html`
full screen and keep `index.html` open in a second tab. Numbers in [brackets] are printed in the chart titles,
so read them off the screen. The spoken part is about 250 words, roughly 1:45 at an easy pace. Not every
member has to appear in the video.

---

**(1) Team** · 0:00 · top of the checkpoint page
> Hi, we're [team name]: [names]. We wanted to know if the hottest climate models are skewing the forecast.

**(2) Dataset** · 0:10 · scroll to the dataset table
> We're using CMIP6 from the course list: [N] climate models run through the same experiments. From monthly
> temperature we worked out each model's sensitivity to CO2, its warming by 2100, and when it reaches two degrees.

**(3) Six exploratory graphs** · 0:30 · about 8 seconds each
> One: the models agree on the past, then fan out to between [low] and [high] degrees by the end of the century.
>
> Two: until about [year], which model you trust matters more than which emissions path we take.
>
> Three: [n] of the [N] models are more sensitive than the IPCC's likely range, and sensitivity predicts
> warming: r is [r].
>
> Four: take those hot models out, and the top of the high-emissions range drops from [a] to [b] degrees,
> while the bottom barely moves.
>
> Five: they also reach two degrees about [gap] years sooner.
>
> Six: but compare models at the same global warming instead of the same year, and the Arctic spread is
> [first number] degrees, not [second number].

**(4) Title and question** · 1:20 · "Our question" at the bottom of the page
> Our graphic is called Too Hot to Trust, and our question is: is CMIP6's scariest future driven by models that
> run too hot, and does that change what a warmer world looks like, or only when we get there?

**(5) Current progress** · 1:30 · switch to the `index.html` tab
> Here's our interactive D3 version. *(Click "IPCC likely range".)* Keep only the IPCC-range models and the
> end-of-century forecast drops from [x] to [y]. *(Click "Warming level".)* Compare by warming level, and the
> Arctic lines line up. Next, we're writing up our design choices.

[x] and [y] are in the subtitle at the top of `index.html` (the middle-of-the-road scenario, SSP2-4.5).

---

**Before uploading:** under 2:00, voice audible, file is `.mp4`. One person submits on Gradescope and adds every
team member.
