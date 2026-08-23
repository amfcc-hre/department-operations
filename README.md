# AMFCC Department Operations

The protected work platform for HODs, departments, Student Leadership and School Administration. Staff Services has been retired. Kitchen and Clinic work now lives inside this site.

## Repository

Create a public repository named `amfcc_department_operations`, upload every file in this package to its root, and enable GitHub Pages from the `main` branch.

## Site

https://amfcc-hre.github.io/amfcc_department_operations/

## Access

- HODs and department staff choose their department and use its unique four-digit PIN.
- Student Leadership uses its existing four-digit Student Leadership PIN.
- School Administration uses its existing four-digit Administrator PIN.
- No individual staff PINs are required.
- School Administration sets or replaces each department PIN from the Department access tab.

## Student Leadership and School Administration replacement

- The Student services tab replaces the previous Student Leadership and School Administrator dashboards.
- Student Leadership retains campus status, outing type, accommodation, gate-pass viewing, gate duty, recent movements and exports.
- Management retains senior gate-pass decisions.
- School Administration also receives fee status, Administrator gate-pass approval, departure and return amendments, and school settings.
- Student Leadership cannot see fees or confidential Clinic notes.

## Department workspaces

- Every department receives tasks, session requests, daily reporting, report history, planning, stock and usage tools, and activity records.
- Kitchen also receives meal-service check-in and export tools, plus a link to the separate student meal check-in page.
- Clinic also receives bed-rest management and protected medication and materials tracking.
- Poultry, Layers and Broilers receive feed and flock-focused wording.
- Horticulture, Open Field and Greenhouses receive crop, input and harvest-focused wording.
- All lists start empty. Departments enter their own stock items, categories, plan types and record types.

## Task planning

- Planned requests for the next day close at 6:00 pm Africa/Harare time.
- Unexpected work uses the Unexpected task request type.
- Holiday mode exposes Morning and Afternoon task slots.
- Departments request a total headcount, including their members, and cannot request names.
- Student Leadership approves or edits the total and assigns 1st year men, 1st year ladies, 2nd year men or 2nd year ladies.

## Conference Mode

Conference Mode is not a calendar mode. It is an overlay on School Term or Holiday Mode. While it is on, meal planning has no deadline, manual-work sessions and group allocations are unavailable, and open or new work is treated as Emergency work with Critical priority. The selected School Term or Holiday gate-pass rules remain active.

The Supabase database migrations are already deployed. Do not run the SQL files again. The Jira outbox worker remains unchanged.
