# AMFCC Department Operations

The protected operating platform for AMFCC departments, HODs, Student Leadership, Management and School Administration.

**Repository:** [amfcc-hre/department-operations](https://github.com/amfcc-hre/department-operations)  
**Live site:** [AMFCC Department Operations](https://amfcc-hre.github.io/department-operations/)

## Purpose

Department Operations is the main staff work platform. It replaces the former Staff Services page and the separate Student Leadership and School Administrator dashboards.

It connects departmental work, student allocations, task planning, daily reporting, weekly and monthly reporting, department-specific tools and student-operations administration in one system.

Kitchen staff and Clinic staff work belongs here. Student self-service meal check-in and personal gate-pass requests remain in Student Services.

## Access model

| Workspace | Main permissions |
| --- | --- |
| Department | Simple task submission, own task list, daily and period reports, and department-specific operational tools |
| Student Leadership | One-page task approval and allocation, cohort availability, weekly duty rosters, standing-department setup, student-services operations and task exports |
| Management | Operational oversight, senior gate-pass actions, reports, planning and management actions |
| School Administration | Clickable overview, open task list, weekly duty rosters, student and pass summaries, report attention, student fee status, Administrator pass decisions, system settings and department PIN management |

- Every department has one shared four-digit PIN.
- Individual staff PINs are not required.
- Staff select or type their name only when recording work so the activity has an owner.
- Departments cannot request named students.
- School Administration can replace department PINs from the Department access section.
- IT Administration can change every role and department PIN from the separate IT Administration site.

## Standard department workspace

Every department receives a workspace named and organised around its work. Standard capabilities include:

- Current work overview and notifications.
- One short form to submit work for a working day without choosing a session.
- Normal, Important or Crucial priority. Crucial work requires an explanation.
- Recurring work with daily, weekly, monthly or quarterly frequency.
- Unexpected same-day work.
- Daily departmental reports.
- Previous report history.
- Weekly and monthly reports built from daily records.
- Blank planning, stock and activity tools that the department configures itself.
- Internal stock or material transfers between departments.
- Management actions created from reviewed reports.

Department tool lists intentionally start empty. Users enter their own item names, categories, units, plan types and record types instead of selecting preloaded assumptions.

## Configured departments

### Main operational and project workspaces

- IT Department
- Husbandry
- Horticulture
- Maintenance
- Painting
- Flowers
- Poultry
- Layers
- Broilers
- Building
- Media
- Chairs & Upholstery
- Kitchen
- Clinic
- Bakery
- Tuckshop
- Fisheries
- Transport
- Finance / Accounts
- Conference Centre

Finance / Accounts is currently limited to its departmental operations and spending records. This platform does not replace the school's accounting system.

### Horticulture structure

Horticulture is the main department and uses one Horticulture PIN.

- Open Field reports separately under Horticulture.
- Greenhouses reports separately under Horticulture.
- Greenhouse 1, Greenhouse 2 and Greenhouse 3 are subsections of Greenhouses.
- Open Field and Greenhouses do not appear as separate login workspaces.

## Kitchen Operations

Kitchen is a daily service, so its first page is Meal service rather than the general task page.

- Scan student cards with a connected 2D scanner on an iPad or computer.
- Enter a five-digit registration number manually when required.
- View meal totals and recent check-ins.
- Open the dedicated full-screen scanner in `meal-checkin.html`.
- Export meal-attendance records.
- Plan daily or weekly meals.
- Track ingredients, food received, food used, wastage and remaining stock.
- Submit occasional tasks only when Kitchen needs work outside its normal daily service.

The Kitchen staff scanner uses the protected Kitchen Operations session and does not depend on the Student Services repository.

Students still use the separate Student Meal Check-In page in Student Services.

## Clinic Operations

Clinic opens directly to its protected register.

- Search students by name or registration number.
- Start or end bed-rest permission.
- View students currently on bed rest.
- Track medication and material stock.
- Record non-confidential Clinic activity totals.
- Submit Clinic reports and request extra help when required.

Student Leadership cannot see confidential Clinic notes.

## IT Department Operations

The IT Department workspace includes the normal IT service desk, planning, stock and activity records plus two protected external-system launchers:

- [AssetTiger](https://www.assettiger.com/) for the authoritative school asset register.
- [Bitwarden Web Vault](https://vault.bitwarden.com/) for the IT password manager.

The links open in separate browser tabs. Department Operations does not embed the sites, copy their databases or store their credentials.

Use a Bitwarden organisation and collections when more than one authorised IT person needs shared access. Put shared school credentials in the appropriate collection rather than sharing an individual's private vault. Passwords, recovery codes, emergency-access documents and vault exports must never be entered into Department Operations, its activity notes, Supabase or GitHub.

The AssetTiger button currently opens the standard sign-in page because a school-specific AssetTiger URL was not supplied. Replace only that URL in `operations.js` if the school has a direct workspace link. A future read-only AssetTiger summary can use its API, but its API key must be held server-side.

## Tasks and student allocations

- Planned requests for the next day must be submitted by 6:00 pm in the `Africa/Harare` time zone.
- Work that appears after the deadline is submitted as an Unexpected task.
- Departments choose only the working day. They do not choose a work session.
- Student Leadership chooses the session and may place the work later in the day or week.
- Configured department members are added to the task total automatically. Departments enter only the number of extra students needed.
- Departments cannot request specific students or specific names.
- Student Leadership can approve the requested number or reduce it to the number available.
- Student Leadership sees availability for 1st year men, 1st year ladies, 2nd year men and 2nd year ladies.
- Group allocations use cohort labels. The task does not need to list every student name.
- Approval, session choice, approved total and the four cohort allocations are completed on the same task card.
- Student Leadership can export the filtered task list as a CSV file for Excel.
- Student Leadership can enter the Prefect on Duty and Senior Prefect on Duty for the current week or future weeks.
- A department can be marked always on for every day and session, or for selected days and sessions. Its configured cohort counts are reserved before the remaining group numbers are shown.

School Administration opens to Overview. Its navigation intentionally excludes Daily report, Meal scanner, Session requests, Department tools and Transfers. The overview links directly to open tasks, on-campus and off-campus students, pending and overdue passes, duty rosters, report attention, notifications, work attention and AssetTiger.

Student Leadership does not review or approve department reports. Management and School Administration retain report attention and approval work.

## Student Services operations

The Student services section is the supported replacement for the former staff dashboards.

Every people list can be narrowed by gender, class and current campus status. These filters work together. A group gate pass appears when at least one person on the pass matches all three selected person filters.

Student Leadership can work with:

- campus status and outing type;
- accommodation information;
- gate-pass viewing;
- gate duty and recent movements; and
- permitted operational exports.

Management can perform the senior gate-pass decision assigned to the Principal, Dean or Director role.

School Administration also receives:

- student fee status;
- School Administrator gate-pass decisions;
- pass departure and return amendments;
- School Term or Holiday settings;
- the Conference Mode overlay; and
- student-services and meal-attendance exports.

Student Leadership cannot see fees or confidential Clinic notes.

## Operating modes

The platform always has one base mode. Conference Mode is an optional overlay.

| Mode | Operational effect |
| --- | --- |
| School Term Mode | Standard deadlines, gate-pass rules and the regular manual-work timetable |
| Holiday Mode | Morning and Afternoon task slots plus the holiday gate-pass rules |
| Conference Mode overlay | No meal deadline, no manual-work sessions or group allocations, and all active work is treated as Emergency work |

Conference Mode can be enabled alongside School Term Mode or Holiday Mode. It is not a third base mode. The selected base mode continues to control gate-pass rules.

## Jira integration

Department reports and management actions can be placed in the Jira outbox for synchronisation when Jira integration is configured.

- Jira configuration is optional.
- The site remains usable when Jira is not configured.
- Student names are not sent to Jira.
- The existing outbox worker is not included in this static repository package.

## Security model

- Browser files contain a Supabase publishable key only.
- Never add a Supabase secret key or legacy `service_role` key to this repository.
- Never store password-manager secrets, recovery codes, AssetTiger API keys or vault exports in this repository or in Department Operations records.
- PINs are verified in the database and are not stored in browser files.
- A successful login receives a temporary Operations session token.
- Protected database functions validate the session role and department before completing an action.
- The raw PIN is not retained and is not sent again after login.
- Staff names are used for operational ownership and audit records, not as authentication credentials.

## Main repository files

| File | Purpose |
| --- | --- |
| `index.html` | All protected Operations workspaces |
| `operations.js` | Login, role permissions, tasks, reports, tools and student-services behaviour |
| `operations.css` | Operations layout and responsive styling |
| `meal-checkin.html` | Full-screen protected Kitchen scanner |
| `meal-checkin.js` | Kitchen card-scanning and check-in workflow |
| `meal-checkin.css` | Full-screen scanner styling |
| `sw.js` | Service-worker caching for the Operations site |
| `manifest.webmanifest` | Installable web-app details |
| `shared_config.js` | Supabase project URL and publishable key |
| `shared_ui.css` | Shared interface styling |

## Deployment with GitHub Pages

1. Open the existing public repository `department-operations` under the `amfcc-hre` account.
2. Upload every file from this folder to the repository root.
3. Keep all filenames and folder levels unchanged.
4. Open **Settings > Pages** in GitHub.
5. Select **Deploy from a branch**.
6. Select the `main` branch and the `/ (root)` folder.
7. Wait for GitHub Pages to publish the site.
8. Open the live-site link above in a private browser window.

The Supabase database migrations are already deployed. Do not run the SQL reference files again during a normal website update.

## First-use checks

1. Sign in as Student Leadership and confirm the four-digit PIN works.
2. Sign in as School Administration and confirm fee status and settings are visible.
3. Sign in to a normal department and submit a test work request without choosing a session.
4. Sign in to Horticulture and confirm one PIN opens the workspace with Open Field and Greenhouses report choices.
5. Sign in to Kitchen and confirm Meal service opens first.
6. Scan a test student card and confirm the scanner becomes ready for the next card.
7. Sign in to Clinic and confirm the Clinic register opens first.
8. Confirm a next-day department request is accepted before 6:00 pm and becomes Unexpected work after the deadline.
9. Confirm Holiday Mode and Conference Mode appear as separate settings.
10. Confirm Student Leadership cannot see fee information or confidential Clinic notes.
11. In each Student services list, test the gender, class and campus-status filters together.
12. Sign in to IT Department, open AssetTiger and Bitwarden, and confirm both launch in separate tabs without leaving the Operations session.

## Related repositories

- [AMFCC IT Administration](https://github.com/amfcc-hre/it-admin-site): maximum-permission settings and PIN management.
- [AMFCC Student Services](https://github.com/amfcc-hre/amfcc_student_services): student meal check-in and personal gate-pass requests.
- [AMFCC Library](https://github.com/amfcc-hre/library-site): ISBN lookup, catalogue, circulation and loan reporting.
