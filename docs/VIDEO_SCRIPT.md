# Checkpoint video script

Due **Thu 11/05, 11:59 PM** on Gradescope: one mp4 per team, 2:00 at most, with voiceover. Aim for about 1:45.

The course page (dsc106.com, Project 3) asks the video to cover five things, marked (1) to (5) below:
(1) team name and members, (2) the dataset and the aspects of it you plan to use, (3) 5-6 exploratory graphs that
led to your question, (4) the title of your graph or the question you are answering, (5) current progress on the
final interactive graph.

**Before recording:** open https://da0t.github.io/dsc106-project3/checkpoint.html full screen and keep
https://da0t.github.io/dsc106-project3/ open in a second tab. The numbers below are the ones printed in the chart
titles for the real CMIP6 data (processed 2026-11-02); if the data is ever rebuilt, read them off the screen
instead. The spoken part is about 250 words, roughly 1:45 at an easy pace. Not every member has to appear in
the video.

---

**(1) Team** · 0:00 · top of the checkpoint page
> Hi, we're Dat Nguyen, Ivan Hughes, Siming Qi and Kevin Cui. We wanted to know if the hottest climate models
> are skewing the forecast.

If the team picks a name, say it first: "Hi, we're [team name]: ..."

**(2) Dataset** · 0:10 · scroll to the dataset table
> We're using CMIP6 from the course list: 44 climate models run through the same experiments. From monthly
> temperature we worked out each model's sensitivity to CO2, its warming by 2100, and when it reaches two degrees.

**(3) Six exploratory graphs** · 0:30 · about 8 seconds each
> One: the models agree on the past, then fan out to between 2.0 and 4.2 degrees by the end of the century.
>
> Two: until about 2059, which model you trust matters more than which emissions path we take.
>
> Three: 15 of the 44 models are more sensitive than the IPCC's likely range, and sensitivity predicts
> warming: r is 0.86.
>
> Four: take those hot models out, and the top of the high-emissions range drops from 6.5 to 5.6 degrees,
> while the bottom barely moves.
>
> Five: they also reach two degrees about 19 years sooner.
>
> Six: but compare models at the same global warming instead of the same year, and the Arctic spread is
> 2.8 degrees, not 4.6.

**(4) Title and question** · 1:20 · the question at the bottom of the checkpoint page
> Our graphic is called Too Hot to Trust, and our question is: is CMIP6's scariest future driven by models that
> run too hot, and does that change what a warmer world looks like, or only when we get there?

**(5) Current progress** · 1:30 · switch to the interactive graphic tab
> Here's our interactive D3 version. *(Click "IPCC likely range".)* Keep only the IPCC-range models and the
> end-of-century forecast drops from 3.0 to 2.8 degrees. *(Click "Warming level".)* Compare by warming level,
> and the Arctic lines line up. Next, we're writing up our design choices.

---

**Before uploading:** under 2:00, voice audible, file is `.mp4`. One person submits on Gradescope and adds every
team member.
