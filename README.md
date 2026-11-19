
# PM4PY extension for geopolitics

I build this PM4PY extension to solve some problems that i was having trying to apply process mining techniqes to event data of international actors.

## Interactive graph explorer

[Open the graph explorer on GitHub Pages](https://sashamorecode.github.io/Geopolitics-Process-Mining/).

To run it locally, start the server from the repository root and open [localhost:8000](http://localhost:8000).

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory explorer/dist
```

GitHub Pages serves the root of the `gh-pages` branch. To publish committed explorer changes from `main`, run `node --test explorer/test/*.test.mjs && git subtree push --prefix explorer/dist origin gh-pages`.

Select a dataset, directed country pair, inclusive year range, and CAMEO action types. The graph and transition table update as you change the controls. Switch between directly-follows, eventually-follows, and action–reaction graphs, or adjust the time window, normalization, and minimum edge weight. Select an action or transition to inspect it. The table includes all matching transitions, including those beyond the graph’s display limit.

In **Action–reaction**, a USA → DEU event connects to later DEU → USA events. Select **Both directions** to include German actions followed by US responses as well. In **Chained action–reaction**, select a third country or extend the route with **Add country**. For USA → DEU → GBR, the graph links US actions toward Germany to later German actions toward the UK. **Close the loop** also includes GBR → USA and compares that leg with USA → DEU. Each edge counts matches between adjacent legs within the selected time window. A path across several edges can combine separate episodes. Node and transition details identify the actor and recipient.

Open **Sources → View** in any transition table to see the source and following story for each counted event pair. Phoenix links each event’s article ID to its headline and Lexis document URL in the Cline Center’s companion metadata. Lexis may require institutional access. ICEWS supplies publisher names and story IDs and withholds article URLs.

The bundled indexes cover cross-country events with identified country or territory affiliations in these releases:

- **Phoenix, New York Times (1980–2018)**. Adapted from Althaus, Bajjalieh, Carter, Peyton and Shalmon (2020), Cline Center Historical Phoenix Event Data v1.3.0, CC BY 4.0. [Dataset](https://doi.org/10.13012/B2IDB-0647142_V3) · [License](https://creativecommons.org/licenses/by/4.0/)
- **ICEWS (1995–1999)**. Adapted from the five annual event files in Boschee et al. (2015), ICEWS Coded Event Data, Harvard Dataverse. The explorer maps source and target country names to codes and uses the first two digits of the CAMEO action. [Dataset](https://doi.org/10.7910/DVN/28075)

Both sources resolve events to calendar days. Within a direction, same-day events retain file order. Action–reaction edges require a strictly later date within the selected window. Edge counts describe sequences of reported events and do not establish causation.

### Time-decayed transitions

In **Eventually follows**, **Action–reaction**, or **Chained action–reaction**, select **Weight closer events more heavily** to see the falloff across at least two half-lives. If the matching window ends sooner, a dashed line shows how the curve continues beyond the cutoff. By default each eligible pair contributes 1. Set **Half-life (days)** to any positive number, including fractional days. A pair separated by `d` days contributes `2 ** (-d / half_life_days)`. With the default of 7 days, at 3 days the weight is 0.743, at 7 days it is 0.5, and at 60 days it is 0.00263 if the window extends that far. Pairs outside the window contribute nothing. **Count** still shows the number of pairs. Normalization, denoising, and minimum weight operate on the summed contributions.

Exponential decay is an established way to weight event history in relational event models. It gives the half-life a straightforward interpretation across windows of different lengths. [Relational event modeling of conflict dynamics](https://doi.org/10.1007/978-3-030-29333-8_4)

For the time scale, Goldstein and colleagues studied daily interactions among 12 Middle Eastern dyads. Their models needed 28 days of lags in 1979–1990 and 6 in 1991–1995. A one-week half-life emphasizes the faster interactions while still giving a four-week-old pair one-sixteenth of its original weight. Seven days is an exploratory modeling choice. The study estimated lag lengths and did not fit this curve to Phoenix or ICEWS. [Goldstein et al., 2001, especially note 35](https://doi.org/10.1177/0022002701045005003)

In Python, pass `time_decay=True` to `make_efig`, `get_eventually_follows_in_days_graph`, or `get_action_reaction_graph`. For example, `make_efig(log, daysFollow=60, time_decay=True, half_life_days=14, show=False)` returns summed weights per edge using a two-week half-life. Python uses elapsed time, including fractional days when timestamps provide them. For normalized weights, use `normalize=True, normalize_to="source"` or `"target"` on `make_efig`, or pass `normalize_to` directly to either discovery function. This calculates the shares while the relative weights are still available, even when a raw weight would round to zero.

The browser loads event indexes on demand. To regenerate them, place the Phoenix event CSV and its companion `MetaDataBLN-NYT_1980-2018.csv` in `data/` and the five original ICEWS annual ZIPs in `data/icews/`, then run `python3 explorer/build_data.py`. The builder reads the ISO 3166-1 JSON from the system's `iso-codes` package, or a path supplied with `--iso`. Run the graph-engine tests with `node --test explorer/test/*.test.mjs`.

# Preproccessing
This is the only part of the code that is spesific to the [data set](https://databank.illinois.edu/datasets/IDB-2796521) i was trying to apply pm4py to. It converts the data set into a pandas DB and creates case id's by concatonating the ID's of source and target country to create a "ConflitID", additionaly it translates the action codes to make the graphs more legible

# Discovery
For this project i mostly wanted to investigate the applicatbility of process mining to attain information on state to state interatctions through the medium of DFGs(Directly Follows Graph), however for this type of data the only real Cases we have is the Case of all actions form one contry to another. The issue i ran into with normal DFG's is that it would not connect events that happend perhapse a few events appart, which in this context makes little sence as any given event is likly causly linked to the next couple of events not just the one directly following it. To circumvent this issue i created the eventually follows in graph (EFIG) that connects each event to all events that happen within x days of said event.

EFIG USA->DEU
![image](https://github.com/sashamorecode/Geopolitics-Process-Mining/assets/34610924/62d2b959-2f45-4105-92f7-a09cdaf103be)

But this is still only connecting actions form state A->B, showing only how contry A's prior actions towards B effect contry A's later actions towards B when what I really wanted was to create action reaction graphs where actions A->B would be connected with acitons B->A. So I crated get_action_reaction_graph which also implements EFIG but instead connects actions to later reactions, instead on later actions. And if we want the full picture we can use merge_action_reaction_graphs to merge action reaction A->B with action reaction graph B->A to get a full picture of the contries interactions.

Actions reaction graph USA->DEU
![image](https://github.com/sashamorecode/Geopolitics-Process-Mining/assets/34610924/62997780-4fb9-4326-a764-479d175eae1f)
Merged Action Reaction graphs USA<->DEU
![image](https://github.com/sashamorecode/Geopolitics-Process-Mining/assets/34610924/96eff09c-3e35-480b-80c7-630f99000679)
You can even chain these action reaction graphs although it quickly gets to messy to interpret.
![image](https://github.com/sashamorecode/Geopolitics-Process-Mining/assets/34610924/66fe4858-bf95-4613-b441-43ced6c076b5)


# Normilization and Reduction
To be able to interpret the graphs i wanted a way to normalize them so that we have more to go on than total counts, to do this i created soruce normalize and target normalize which both can be applied to any weighted Directed Graph. The way

## Target Normalize
normalize the edges to each target node to sum to 1
so we can see how much percent of the incoming transitions each transition represents

## Source Normalize
The weights of the edges leaving each source node sum to 1. Each weight gives the share of transitions leaving that source action.

## Reduction
Finnaly i also created some functions to clear out noise and give a clear picture as i was getting very messy densly conected graphs as almost every node is connected to each other node at least once especialy for EFIG's. The two reductions are min thresh wich simply removes any edge under a given value and max path denoise which for each node only retains the largest in edge and the largest out edge.
