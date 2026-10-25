#!/usr/bin/perl
# Incrementally folds Claude Code transcripts into a lasting token ledger and
# prints a JSON summary.
#
#   perl scan.pl <ledger-dir> <current-session-id> <projects-dir>...
#
# The ledger outlives the transcripts (Claude Code deletes old ones after
# cleanupPeriodDays), so yearly and lifetime totals keep growing.
# Each assistant message is counted once, keyed by message id + request id.
use strict;
use warnings;
use JSON::PP;
use Time::Local qw(timegm);
use File::Find;
use File::Path qw(make_path);

my ($ledger_dir, $current_sid, @roots) = @ARGV;
die "usage: scan.pl <ledger-dir> <session-id> <projects-dir>...\n" unless $ledger_dir && @roots;
make_path($ledger_dir);

my $json = JSON::PP->new->canonical;
my $state_path = "$ledger_dir/state.json";
my $seen_path  = "$ledger_dir/seen.txt";

my $state = { files => {}, buckets => {}, sessions => {} };
if (open my $fh, '<', $state_path) {
    local $/;
    my $text = <$fh>;
    $state = eval { $json->decode($text) } || $state;
}

my %seen;
if (open my $fh, '<', $seen_path) {
    while (<$fh>) { chomp; $seen{$_} = 1 }
}
open my $seen_out, '>>', $seen_path or die "cannot append $seen_path: $!";

my @files;
for my $root (@roots) {
    next unless -d $root;
    find({ no_chdir => 1, wanted => sub { push @files, $File::Find::name if /\.jsonl\z/ && -f $_ } }, $root);
}

# [input, output, cache_write, cache_read, messages]
sub add { my ($acc, $u) = @_; $acc->[$_] += $u->[$_] for 0 .. 4; $acc }

sub local_day {
    my ($iso) = @_;
    return undef unless $iso && $iso =~ /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/;
    my $epoch = timegm($6, $5, $4, $3, $2 - 1, $1);
    my @t = localtime $epoch;
    return (sprintf('%04d-%02d-%02d', $t[5] + 1900, $t[4] + 1, $t[3]), $epoch);
}

my $added = 0;
for my $path (@files) {
    my @st = stat $path or next;
    my ($size, $mtime) = ($st[7], $st[9]);
    my $known = $state->{files}{$path} ||= { offset => 0 };
    next if ($known->{size} // -1) == $size && ($known->{mtime} // -1) == $mtime;
    my $offset = $size < $known->{offset} ? 0 : $known->{offset};

    # session: <sid>.jsonl, or <sid>/subagents/agent-*.jsonl counted to its parent
    my ($project, $sid) = $path =~ m{/([^/]+)/([0-9a-f-]{36})(?:\.jsonl|/)};
    $sid //= 'unknown';
    $project //= 'unknown';

    open my $fh, '<', $path or next;
    seek $fh, $offset, 0;
    while (my $line = <$fh>) {
        last unless $line =~ /\n\z/;    # a line still being written: next scan
        $offset += length $line;
        next unless index($line, '"usage"') >= 0 && index($line, '"assistant"') >= 0;
        my $row = eval { $json->decode($line) } or next;
        next unless ($row->{type} // '') eq 'assistant';
        my $m = $row->{message} or next;
        my $u = $m->{usage} or next;
        my $model = $m->{model} // 'unknown';
        next if $model eq '<synthetic>';
        my $key = join ':', $m->{id} // '', $row->{requestId} // '';
        next if $key eq ':' || $seen{$key}++;
        print $seen_out "$key\n";

        my ($day, $epoch) = local_day($row->{timestamp});
        next unless $day;
        my $t = [
            $u->{input_tokens} // 0,
            $u->{output_tokens} // 0,
            $u->{cache_creation_input_tokens} // 0,
            $u->{cache_read_input_tokens} // 0,
            1,
        ];
        add($state->{buckets}{"$day\t$model"} ||= [0, 0, 0, 0, 0], $t);
        my $s = $state->{sessions}{$sid} ||= { t => [0, 0, 0, 0, 0], project => $project, first => $epoch, last => $epoch };
        add($s->{t}, $t);
        $s->{first} = $epoch if $epoch < $s->{first};
        $s->{last}  = $epoch if $epoch > $s->{last};
        $added++;
    }
    close $fh;
    @$known{qw(size mtime offset)} = ($size, $mtime, $offset);
}
close $seen_out;

if ($added || !-e $state_path) {
    open my $out, '>', "$state_path.tmp" or die "cannot write ledger: $!";
    print $out $json->encode($state);
    close $out;
    rename "$state_path.tmp", $state_path or die "cannot replace ledger: $!";
}

# --- summary -------------------------------------------------------------
my @now = localtime;
my $today = sprintf('%04d-%02d-%02d', $now[5] + 1900, $now[4] + 1, $now[3]);
my (%year, %month, %day, %model);
my $total = [0, 0, 0, 0, 0];
my $first_day;
for my $k (keys %{ $state->{buckets} }) {
    my ($d, $mod) = split /\t/, $k, 2;
    my $t = $state->{buckets}{$k};
    add($total, $t);
    add($year{ substr $d, 0, 4 } ||= [0, 0, 0, 0, 0], $t);
    add($month{ substr $d, 0, 7 } ||= [0, 0, 0, 0, 0], $t);
    add($day{$d} ||= [0, 0, 0, 0, 0], $t);
    add($model{$mod} ||= [0, 0, 0, 0, 0], $t);
    $first_day = $d if !$first_day || $d lt $first_day;
}
my @recent_days = (sort keys %day)[-14 .. -1];
my @recent_months = (sort keys %month)[-12 .. -1];
my @y = localtime(time - 371 * 86400);
my $year_ago = sprintf('%04d-%02d-%02d', $y[5] + 1900, $y[4] + 1, $y[3]);
my %calendar = map { $_ => $day{$_}[0] + $day{$_}[1] + $day{$_}[2] + $day{$_}[3] } grep { $_ ge $year_ago } keys %day;

my $cur = $state->{sessions}{ $current_sid // '' };
print $json->encode({
    total     => $total,
    today     => $day{$today} // [0, 0, 0, 0, 0],
    todayKey  => $today,
    calendar  => \%calendar,
    session   => $cur ? $cur->{t} : [0, 0, 0, 0, 0],
    years     => [map { { key => $_, t => $year{$_} } } sort keys %year],
    months    => [map { { key => $_, t => $month{$_} } } grep { defined } @recent_months],
    days      => [map { { key => $_, t => $day{$_} } } grep { defined } @recent_days],
    models    => [map { { key => $_, t => $model{$_} } } sort { $model{$b}[1] <=> $model{$a}[1] } keys %model],
    sessions  => scalar keys %{ $state->{sessions} },
    firstDay  => $first_day,
    added     => $added,
    files     => scalar @files,
});
