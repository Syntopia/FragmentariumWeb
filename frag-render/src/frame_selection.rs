use std::collections::BTreeSet;

fn parse_usize(value: &str, label: &str) -> anyhow::Result<usize> {
    value.parse::<usize>().map_err(|_| {
        anyhow::anyhow!(
            "Invalid {} '{}': expected non-negative integer",
            label,
            value
        )
    })
}

pub fn select_frame_indices(spec: Option<&str>, frame_count: usize) -> anyhow::Result<Vec<usize>> {
    if frame_count == 0 {
        anyhow::bail!("Cannot select frames from empty manifest");
    }

    let spec = spec.unwrap_or("all").trim();
    if spec.eq_ignore_ascii_case("all") {
        return Ok((0..frame_count).collect());
    }
    if spec.is_empty() {
        anyhow::bail!("--frames cannot be empty");
    }

    let mut selected = BTreeSet::<usize>::new();
    for raw_token in spec.split(',') {
        let token = raw_token.trim();
        if token.is_empty() {
            anyhow::bail!("--frames contains empty token in '{}'", spec);
        }

        let (range_part, step) = if let Some((left, right)) = token.split_once(':') {
            let parsed_step = parse_usize(right.trim(), "range step")?;
            if parsed_step == 0 {
                anyhow::bail!("Frame range step must be > 0 in token '{}'", token);
            }
            (left.trim(), parsed_step)
        } else {
            (token, 1usize)
        };

        if let Some((start_raw, end_raw)) = range_part.split_once('-') {
            let start = parse_usize(start_raw.trim(), "range start")?;
            let end = parse_usize(end_raw.trim(), "range end")?;
            if start > end {
                anyhow::bail!("Invalid frame range '{}': start > end", token);
            }
            let mut index = start;
            while index <= end {
                if index >= frame_count {
                    anyhow::bail!(
                        "Selected frame {} out of bounds [0, {}] in token '{}'",
                        index,
                        frame_count - 1,
                        token
                    );
                }
                selected.insert(index);
                match index.checked_add(step) {
                    Some(next) => index = next,
                    None => break,
                }
            }
        } else {
            let index = parse_usize(range_part, "frame index")?;
            if index >= frame_count {
                anyhow::bail!(
                    "Selected frame {} out of bounds [0, {}] in token '{}'",
                    index,
                    frame_count - 1,
                    token
                );
            }
            selected.insert(index);
        }
    }

    if selected.is_empty() {
        anyhow::bail!("--frames did not select any frames");
    }
    Ok(selected.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::select_frame_indices;

    #[test]
    fn selects_all_by_default() {
        let indices = select_frame_indices(None, 5).expect("default selection should work");
        assert_eq!(indices, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn supports_single_values_ranges_and_steps() {
        let indices =
            select_frame_indices(Some("0,2,4-8:2,10-12"), 20).expect("selection spec should parse");
        assert_eq!(indices, vec![0, 2, 4, 6, 8, 10, 11, 12]);
    }

    #[test]
    fn rejects_out_of_bounds_selection() {
        let error = select_frame_indices(Some("0,12"), 10).expect_err("out of bounds must fail");
        assert!(error.to_string().contains("out of bounds"));
    }

    #[test]
    fn rejects_reverse_range() {
        let error = select_frame_indices(Some("9-4"), 20).expect_err("reverse range must fail");
        assert!(error.to_string().contains("start > end"));
    }
}
