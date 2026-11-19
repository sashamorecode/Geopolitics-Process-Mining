import pandas
import pm4py


def code2text_Pheonix(event_log):
    #translatets root_codes for pheonix data
    translationMap = {"1":"Make Public Statement", "2":"Appeal", "3":"Express intent to cooperate",
                    "4":"Consult", "5":"Engage in diplomatic cooperation","6":"Engage in material cooperation",
                    "7":"Provide aid", "8":"Yield", "9":"Investigate", 
                    "10":"Demand", "11":"Disapprove", "12":"Reject", 
                    "13":"Threaten", "14":"Protest", "15":"Exhibit force posture", 
                    "16":"Reduce relations", "17":"Coerce", "18":"Assault",
                    "19":"Fight","20":"Use unconventional mass violence"}
    def translate(x):
        return translationMap[str(x)]
    event_log['root_code_text'] = event_log['root_code'].apply(translate)    
    return event_log

def preprocess(event_log, key="empty", remove_activity_keys=(), start_date=None, end_date=None):
    event_log = event_log.loc[~event_log["root_code"].isin(remove_activity_keys)].copy()
    event_log["source_root"] = event_log["source"].str[:3]
    event_log["target_root"] = event_log["target"].str[:3]
    event_log["conflict_id"] = event_log["source_root"] + event_log["target_root"]
    if key != "empty":
        event_log = event_log.loc[event_log["conflict_id"] == key].copy()
    event_log = extract_time_range(event_log, start_date, end_date)

    event_log = code2text_Pheonix(event_log)
    return pm4py.format_dataframe(
        event_log, case_id="conflict_id", activity_key="root_code_text", timestamp_key="story_date"
    )


def import_csv(file_path):
    event_log = pandas.read_csv(file_path, sep=',')
    return event_log 

def extract_time_range(event_log, start_date=None, end_date=None):
    """Select events on or between the supplied UTC calendar dates."""
    try:
        dates = pandas.to_datetime(event_log["story_date"], utc=True)
    except ValueError:
        # pandas 2+ infers a single format by default, even for mixed ISO dates and timestamps.
        dates = pandas.to_datetime(event_log["story_date"], format="mixed", utc=True)
    selected = dates.notna()
    if start_date is not None:
        selected &= dates >= pandas.to_datetime(start_date, utc=True).normalize()
    if end_date is not None:
        end_day = pandas.to_datetime(end_date, utc=True).normalize()
        selected &= dates < end_day + pandas.Timedelta(days=1)
    return event_log.loc[selected].assign(story_date=dates[selected])
