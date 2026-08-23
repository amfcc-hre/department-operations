# AMFCC Department Operations

The protected work platform for HODs, departments, Student Leadership and School Administration. Staff Services has been retired. Kitchen and Clinic work now lives inside this site.

## Repository

Create a public repository named `amfcc_department_operations`, upload every file in this package to its root, and enable GitHub Pages from the `main` branch.

## Site

https://amfcc-hre.github.io/amfcc_department_operations/

## Access

- HODs and department staff choose their department and use its unique four-digit PIN.
- Student Leadership uses its existing Student Services password.
- School Administration uses its existing Admin password.
- No individual staff PINs are required.
- School Administration sets or replaces each department PIN from the Department access tab.

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

The Supabase database migrations are already deployed. Do not run the SQL files again. The Jira outbox worker remains unchanged.
