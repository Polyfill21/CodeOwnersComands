#!/bin/bash

echo "Checking if all required owners have approved the changes..."

# Read changed files into an array
mapfile -t changed_files < changed_files.txt

# Load approval rules from JSON file
approval_rules_path="$(dirname "$0")/../approval_rules.json"
paths=$(jq -r 'keys[]' "$approval_rules_path")
approved_reviewers=$(cat approved_reviewers.txt)
all_required_approved=true
required_owners=()

# Loop over each rule and match changed files with rules
for path in $paths; do
  # Get list of owners for the current path
  owners=$(jq -r --arg path "$path" '.[$path][]' "$approval_rules_path")
  echo "Processing rule for path '$path' with owners: $owners"

  # Find changed files matching the current path
  # Using grep with -E to match both exact path and nested directories
  matched_files=$(printf "%s\n" "${changed_files[@]}" | grep -E "^$path")

  if [[ -n "$matched_files" ]]; then
    echo "Files matching rule '$path':"
    echo "$matched_files"
    # Read owners into an array and add them to required owners
    mapfile -t owners_array < <(echo "$owners")
    required_owners+=("${owners_array[@]}")
  else
    echo "No changed files match the rule for path '$path'"
  fi
done

# Check if there are any required owners
if [[ ${#required_owners[@]} -eq 0 ]]; then
  echo "No approval rules match the changed files."
  exit 0  # Exit without error if there are no matching rules
fi

# Remove duplicates from the list of required owners
unique_required_owners=($(printf "%s\n" "${required_owners[@]}" | sort -u))
echo "Total required owners for all files: ${unique_required_owners[@]}"

# Normalize usernames to lowercase for comparison
approved_reviewers_normalized=$(echo "$approved_reviewers" | tr '[:upper:]' '[:lower:]')
unique_required_owners_normalized=($(printf "%s\n" "${unique_required_owners[@]}" | tr '[:upper:]' '[:lower:]'))

# Check that each required owner has approved the changes
for owner in "${unique_required_owners_normalized[@]}"; do
  if ! echo "$approved_reviewers_normalized" | grep -qw "$owner"; then
    echo "Error: Required owner '$owner' has not approved the changes."
    all_required_approved=false
  else
    echo "Owner '$owner' has approved the changes."
  fi
done

# Output the result
if [ "$all_required_approved" = false ]; then
  echo "Not all required owners have approved the changes."
  exit 1
else
  echo "All required owners have approved the changes."
fi
