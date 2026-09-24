param(
  [string]$SupabaseUrl = "",
  [string]$AnonKey = "",
  [switch]$AllowUnavailableTurn
)

$ErrorActionPreference = "Stop"

function Resolve-ConfiguredValue {
  param(
    [string]$ExplicitValue,
    [string]$EnvironmentName,
    [string]$GitHubVariable
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
    return $ExplicitValue.Trim()
  }

  $environmentValue = [Environment]::GetEnvironmentVariable($EnvironmentName)
  if (-not [string]::IsNullOrWhiteSpace($environmentValue)) {
    return $environmentValue.Trim()
  }

  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $githubValue = & gh variable get $GitHubVariable 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($githubValue)) {
      return $githubValue.Trim()
    }
  }

  return ""
}

function Invoke-JsonProbe {
  param(
    [string]$Uri,
    [string]$Key,
    [string]$Body
  )

  $request = @{
    Uri = $Uri
    Method = "Post"
    Headers = @{
      apikey = $Key
      Authorization = "Bearer $Key"
      "Content-Type" = "application/json"
    }
    Body = $Body
  }

  $invokeWebRequest = Get-Command Invoke-WebRequest
  if ($invokeWebRequest.Parameters.ContainsKey("UseBasicParsing")) {
    $request.UseBasicParsing = $true
  }
  if ($invokeWebRequest.Parameters.ContainsKey("SkipHttpErrorCheck")) {
    $request.SkipHttpErrorCheck = $true
  }

  try {
    $response = Invoke-WebRequest @request
    return @{
      StatusCode = [int]$response.StatusCode
      Content = [string]$response.Content
      NetworkError = $null
    }
  } catch {
    $httpResponse = $_.Exception.Response
    if ($null -ne $httpResponse -and $null -ne $httpResponse.StatusCode) {
      $content = ""
      try {
        $stream = $httpResponse.GetResponseStream()
        if ($null -ne $stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          try {
            $content = $reader.ReadToEnd()
          } finally {
            $reader.Dispose()
            $stream.Dispose()
          }
        }
      } catch {
        $content = ""
      }

      return @{
        StatusCode = [int]$httpResponse.StatusCode
        Content = $content
        NetworkError = $null
      }
    }

    return @{
      StatusCode = 0
      Content = ""
      NetworkError = $_.Exception.Message
    }
  }
}

$SupabaseUrl = Resolve-ConfiguredValue $SupabaseUrl "VITE_SUPABASE_URL" "VITE_SUPABASE_URL"
$AnonKey = Resolve-ConfiguredValue $AnonKey "VITE_SUPABASE_ANON_KEY" "VITE_SUPABASE_ANON_KEY"

if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($AnonKey)) {
  throw "Production runtime smoke requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, passed explicitly, in the environment, or as GitHub repository variables."
}

try {
  $uri = [Uri]$SupabaseUrl
} catch {
  throw "VITE_SUPABASE_URL is not a valid URL."
}

if ($uri.Scheme -ne "https" -or [string]::IsNullOrWhiteSpace($uri.Host)) {
  throw "VITE_SUPABASE_URL must be an HTTPS URL with a host."
}

try {
  $dns = Resolve-DnsName $uri.Host -Type A -ErrorAction Stop
} catch {
  throw "Production Supabase host does not resolve: $($uri.Host). Restore the project or update VITE_SUPABASE_URL before releasing."
}

if (-not ($dns | Where-Object { $_.IPAddress })) {
  throw "Production Supabase host resolved without an IPv4 address: $($uri.Host)."
}

$runtime = Invoke-JsonProbe "$($SupabaseUrl.TrimEnd('/'))/rest/v1/rpc/runtime_capabilities_v2" $AnonKey "{}"
if ($runtime.StatusCode -ne 200) {
  $detail = if ($runtime.NetworkError) { $runtime.NetworkError } else { "HTTP $($runtime.StatusCode)" }
  throw "Runtime capability RPC is unavailable ($detail)."
}

try {
  $runtimeJson = $runtime.Content | ConvertFrom-Json -ErrorAction Stop
} catch {
  throw "Runtime capability RPC returned invalid JSON."
}

$turn = Invoke-JsonProbe "$($SupabaseUrl.TrimEnd('/'))/functions/v1/turn-credentials" $AnonKey '{"action":"diagnostics"}'
$turnExpected = $turn.StatusCode -in @(401, 403)
$turnUnavailable = $turn.StatusCode -in @(404, 503)

if (-not $turnExpected) {
  if ($AllowUnavailableTurn -and $turnUnavailable) {
    Write-Warning "TURN remains unavailable (HTTP $($turn.StatusCode)); voice/live-share must stay capability-gated."
  } else {
    $detail = if ($turn.NetworkError) { $turn.NetworkError } else { "HTTP $($turn.StatusCode)" }
    throw "TURN credential function is not release-ready ($detail). Deploy/configure turn-credentials or rerun with -AllowUnavailableTurn only for a deliberately gated build."
  }
}

$schemaGeneration = $runtimeJson.schemaGeneration
if ($null -eq $schemaGeneration) {
  $schemaGeneration = $runtimeJson.schema_generation
}
$schemaDetail = ""
if ($null -ne $schemaGeneration) {
  $schemaDetail = ", schema generation $schemaGeneration"
}

Write-Output "Production runtime smoke passed: $($uri.Host)"
Write-Output "Runtime capability RPC: HTTP 200$schemaDetail"
if ($turnExpected) {
  Write-Output "TURN endpoint: deployed and authentication-gated (HTTP $($turn.StatusCode))"
} elseif ($AllowUnavailableTurn -and $turnUnavailable) {
  Write-Output "TURN endpoint: intentionally gated/unavailable (HTTP $($turn.StatusCode))"
}
