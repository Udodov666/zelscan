[IO.Compression.GZipStream]::new([IO.File]::OpenRead('landing\__states.html.gz'),[IO.Compression.CompressionMode]::Decompress).CopyTo([IO.File]::Create('landing\tariff-states-lab.html'))
