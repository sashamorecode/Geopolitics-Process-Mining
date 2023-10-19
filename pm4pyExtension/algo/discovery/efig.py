from enum import Enum
import pandas
from pm4py.util import exec_utils, xes_constants, constants
from pm4py.objects.conversion.log import converter
from pm4py.objects.log.util import sorting


class Parameters(Enum):
    ACTIVITY_KEY = constants.PARAMETER_CONSTANT_ACTIVITY_KEY
    TIMESTAMP_KEY = constants.PARAMETER_CONSTANT_TIMESTAMP_KEY
    START_TIMESTAMP_KEY = constants.PARAMETER_CONSTANT_START_TIMESTAMP_KEY
    KEEP_FIRST_FOLLOWING = "keep_first_following"




def get_action_reaction_graph(action_event_log, reaction_event_log, daysFollow):
    #all this get param shit is just becuse i stole the code from pm4py and 
    #i dont wanna figure out how to create the right empty data types for everyht   
    
    #action_event_log = preprocess(unprocessed_event_log,key=source_country + target_country, start_date=start_date, end_date=end_date)
    #reaction_event_log = preprocess(unprocessed_event_log,key=target_country + source_country, start_date=start_date, end_date=end_date)
    #print(action_event_log)
    ret_dict = {}
    parameters = {}
    action_event_log = converter.apply(action_event_log, variant=converter.Variants.TO_EVENT_LOG, parameters=parameters)
    reaction_event_log = converter.apply(reaction_event_log, variant=converter.Variants.TO_EVENT_LOG, parameters=parameters)
    activity_key = exec_utils.get_param_value(Parameters.ACTIVITY_KEY, parameters, xes_constants.DEFAULT_NAME_KEY)
    timestamp_key = exec_utils.get_param_value(Parameters.TIMESTAMP_KEY, parameters, xes_constants.DEFAULT_TIMESTAMP_KEY)
    start_timestamp_key = exec_utils.get_param_value(Parameters.START_TIMESTAMP_KEY, parameters, xes_constants.DEFAULT_TIMESTAMP_KEY)
    time_threshold = pandas.Timedelta(days=daysFollow)

    for action_trace in action_event_log:
        for reaction_trace in reaction_event_log:
            action_sorted_trace = sorting.sort_timestamp_trace(action_trace, start_timestamp_key)
            reaction_sorted_trace = sorting.sort_timestamp_trace(reaction_trace, start_timestamp_key)
            i = 0
            while i < len(action_sorted_trace):
                act1 = action_sorted_trace[i][activity_key]
                tc1 = action_sorted_trace[i][timestamp_key]
                #gotta set j to 0 becuse we not ont he same trace anymore
                j = 0
                while j < len(reaction_sorted_trace):
                    ts2 = reaction_sorted_trace[j][timestamp_key]
                    act2 = reaction_sorted_trace[j][activity_key]
                    if ts2 <= tc1 + time_threshold and ts2 > tc1:
                        tup = (act1, act2)
                        if tup not in ret_dict:
                            ret_dict[tup] = 0
                        ret_dict[tup] += 1
                    j += 1
                i += 1
    return ret_dict


def get_eventually_follows_in_days_graph(event_log, daysFollow):
    
    ret_dict = {}
    parameters = {}
    event_log = converter.apply(event_log, variant=converter.Variants.TO_EVENT_LOG, parameters=parameters)
    activity_key = exec_utils.get_param_value(Parameters.ACTIVITY_KEY, parameters, xes_constants.DEFAULT_NAME_KEY)
    timestamp_key = exec_utils.get_param_value(Parameters.TIMESTAMP_KEY, parameters, xes_constants.DEFAULT_TIMESTAMP_KEY)
    start_timestamp_key = exec_utils.get_param_value(Parameters.START_TIMESTAMP_KEY, parameters, xes_constants.DEFAULT_TIMESTAMP_KEY)
    keep_first_following = exec_utils.get_param_value(Parameters.KEEP_FIRST_FOLLOWING, parameters, False)
    time_threshold = pandas.Timedelta(days=daysFollow)
    for trace in event_log:
        sorted_trace = sorting.sort_timestamp_trace(trace, start_timestamp_key)
        i = 0
        while i < len(sorted_trace):
            act1 = sorted_trace[i][activity_key]
            tc1 = sorted_trace[i][timestamp_key]
            j = i + 1
            while j < len(sorted_trace):
                ts2 = sorted_trace[j][timestamp_key]
                act2 = sorted_trace[j][activity_key]
                if ts2 - tc1 <= time_threshold and ts2 >= tc1:
                    tup = (act1, act2)
                    if tup not in ret_dict:
                        ret_dict[tup] = 0
                    ret_dict[tup] += 1
                    if keep_first_following:
                        break
                j += 1
            i += 1
    return ret_dict