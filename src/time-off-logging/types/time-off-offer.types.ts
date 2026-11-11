// What logging an approved time off would write.
export interface ITimeOffOffer {
  requestId: string;
  projectId: string;
  projectName: string;
  // On each day.
  minutes: number;
  // The working days of the time off, as 'YYYY-MM-DD'.
  dates: string[];
}

export interface ITimeOffResult {
  offer: ITimeOffOffer;
  // The days this run wrote.
  logged: string[];
  // What is stored for this request after the run, however it got there: on
  // the project, and within its days on other projects (billed time of the
  // leave type it had before, which stayed when HR changed the type).
  linked: {
    dates: string[];
    minutes: number;
    otherProjects: { projectName: string; dates: string[] }[];
  };
}

export interface ITimeOffPlan {
  offer: ITimeOffOffer;
  // The requester's team now.
  teamId: string | null;
}
