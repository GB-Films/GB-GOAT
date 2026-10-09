param([switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $env:GOOGLE_OAUTH_ACCESS_TOKEN) { throw 'GOOGLE_OAUTH_ACCESS_TOKEN is required (do not store it in a file).' }
$headers = @{ Authorization = "Bearer $env:GOOGLE_OAUTH_ACCESS_TOKEN" }
$serviceAccount = 'bani-project-sync@gb-goat.iam.gserviceaccount.com'

function Invoke-GoogleJson($Uri, $Body) {
  Invoke-RestMethod -TimeoutSec 60 -Method Post -Uri $Uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 30 -Compress)
}

function Add-Binding($Project, $Role, $Database, $Title) {
  $uri = "https://cloudresourcemanager.googleapis.com/v1/projects/${Project}"
  $policy = Invoke-GoogleJson "${uri}:getIamPolicy" @{ options = @{ requestedPolicyVersion = 3 } }
  $member = "serviceAccount:$serviceAccount"
  $condition = if ($Database) { @{ title = $Title; expression = "resource.name == 'projects/$Project/databases/$Database'" } } else { $null }
  $binding = $policy.bindings | Where-Object { $_.role -eq $Role -and $_.condition.expression -eq $condition.expression } | Select-Object -First 1
  if ($binding -and $binding.members -contains $member) { Write-Output "Already configured: $Project $Role"; return }
  if ($binding) { $binding.members = @($binding.members) + $member }
  else {
    $next = @{ role = $Role; members = @($member) }
    if ($condition) { $next.condition = $condition }
    $policy.bindings = @($policy.bindings) + $next
  }
  $policy.version = 3
  if ($Apply) { $null = Invoke-GoogleJson "${uri}:setIamPolicy" @{ policy = $policy }; Write-Output "Configured: $Project $Role" }
  else { Write-Output "Would configure: $Project $Role $($condition.expression)" }
}

$uri = "https://iam.googleapis.com/v1/projects/gb-goat/serviceAccounts/$serviceAccount"
try { $null = Invoke-RestMethod -TimeoutSec 30 -Headers $headers -Uri $uri }
catch {
  if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
  if ($Apply) { $null = Invoke-GoogleJson 'https://iam.googleapis.com/v1/projects/gb-goat/serviceAccounts' @{ accountId = 'bani-project-sync'; serviceAccount = @{ displayName = 'GOAT to BANI project identity sync' } } }
  else { Write-Output "Would create: $serviceAccount" }
}

$roleId = 'baniProjectSync'
$roleUri = "https://iam.googleapis.com/v1/projects/gran-berta-films/roles/$roleId"
try { $role = Invoke-RestMethod -TimeoutSec 30 -Headers $headers -Uri $roleUri }
catch {
  if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
  $permissions = @('datastore.databases.get', 'datastore.entities.get', 'datastore.entities.list', 'datastore.entities.create', 'datastore.entities.update')
  if ($Apply) { $role = Invoke-GoogleJson 'https://iam.googleapis.com/v1/projects/gran-berta-films/roles' @{ roleId = $roleId; role = @{ title = 'BANI project sync'; description = 'Read, create and update project identity. No deletion or Firebase Auth permissions.'; includedPermissions = $permissions; stage = 'GA' } } }
  else { Write-Output 'Would create a no-delete BANI data role.' }
}
Add-Binding 'gran-berta-films' "projects/gran-berta-films/roles/$roleId" 'ai-studio-1ef504c9-77ed-4378-b361-4b3659b5d837' 'bani-project-database'
Add-Binding 'gb-goat' 'roles/datastore.viewer' '(default)' 'goat-project-database'
Add-Binding 'gb-goat' 'roles/logging.logWriter' '' ''
Add-Binding 'gb-goat' 'roles/eventarc.eventReceiver' '' ''

# Eventarc must invoke only this private service, not every service in GOAT.
$serviceUri = 'https://run.googleapis.com/v2/projects/gb-goat/locations/us-central1/services/syncprojecttobani'
try {
  $policy = Invoke-RestMethod -TimeoutSec 30 -Headers $headers -Uri "${serviceUri}:getIamPolicy"
  $member = "serviceAccount:$serviceAccount"
  $binding = $policy.bindings | Where-Object { $_.role -eq 'roles/run.invoker' -and -not $_.condition } | Select-Object -First 1
  if (-not ($binding -and $binding.members -contains $member)) {
    if ($binding) { $binding.members = @($binding.members) + $member }
    else {
      $newBinding = @{ role = 'roles/run.invoker'; members = @($member) }
      if ($policy.PSObject.Properties.Name -contains 'bindings') { $policy.bindings = @($policy.bindings) + $newBinding }
      else { $policy | Add-Member -NotePropertyName bindings -NotePropertyValue @($newBinding) }
    }
    if ($Apply) { $null = Invoke-GoogleJson "${serviceUri}:setIamPolicy" @{ policy = $policy }; Write-Output 'Configured private sync service invocation.' }
    else { Write-Output 'Would grant invocation on the private sync service only.' }
  } else { Write-Output 'Private sync service invocation is already configured.' }
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
  Write-Output 'Sync service not created yet. Repeat this script after function deployment to grant private invocation.'
}
