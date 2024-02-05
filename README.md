
# PM4PY extension for geopolitics

I build this PM4PY extension to solve some problems that i was having trying to apply process mining techniqes to event data of international actors.

# Preproccessing
This is the only part of the code that is spesific to the [data set](https://databank.illinois.edu/datasets/IDB-2796521) i was trying to apply pm4py to. It converts the data set into a pandas DB and creates case id's by concatonating the ID's of source and target country to create a "ConflitID", additionaly it translates the action codes to make the graphs more legible

# Discovery
For this project i mostly wanted to investigate the applicatbility of process mining to attain information on state to state interatctions through the medium of DFGs(Directly Follows Graph), however for this type of data the only real Cases we have is the Case of all actions form one contry to another. The issue i ran into with normal DFG's is that it would not connect events that happend perhapse a few events appart, which in this context makes little sence as any given event is likly causly linked to the next couple of events not just the one directly following it. To circumvent this issue i created the eventually follows in graph (EFIG) that connects each event to all events that happen within x days of said event.

Actions reaction graph USA->DEU
![image](https://github.com/sashamorecode/Geopolitics-Process-Mining/assets/34610924/62997780-4fb9-4326-a764-479d175eae1f)

But this is still only connecting actions form state A->B, showing only how contry A's prior actions towards B effect contry A's later actions towards B when what I really wanted was to create action reaction graphs where actions A->B would be connected with acitons B->A. So I crated get_action_reaction_graph which also implements EFIG but instead connects actions to later reactions, instead on later actions. And if we want the full picture we can use merge_action_reaction_graphs to merge action reaction A->B with action reaction graph B->A to get a full picture of the contries interactions.

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
normalize the edges to each source node to sum to 1
so we can see how much percent of the incoming transitions each transition represents

Finnaly i also created some functions to clear out noise and give a clear picture as i was getting very messy densly conected graphs as almost every node is connected to each other node at least once especialy for EFIG's. The two reductions are min thresh wich simply removes any edge under a given value and max path denoise which for each node only retains the largest in edge and the largest out edge.

PS i am student and cannot vouch for the validity of the code, use at your own peril
